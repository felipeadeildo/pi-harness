// The server side of a WebSocket, from the bundled `ws` package.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";

export type { WebSocket };

/** A client sends commands, never files. */
const MAX_MESSAGE = 1024 * 1024;

/** A phone that lost signal may never close its TCP socket; a ping with no pong closes it. */
export const PING_EVERY_MS = 10_000;

export interface WebSocketHandlers {
	message(text: string): void;
	closed(): void;
}

export function server(): WebSocketServer {
	return new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
}

export function accept(
	wss: WebSocketServer,
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer,
	open: (ws: WebSocket) => WebSocketHandlers,
	liveness: { pingEvery?: number } = {},
): void {
	wss.handleUpgrade(request, socket, head, (ws) => {
		const handlers = open(ws);
		ws.on("message", (data) => handlers.message(String(data)));
		ws.on("error", () => ws.terminate());
		// A peer that missed a beat is terminated by the next one.
		let answered = true;
		ws.on("pong", () => {
			answered = true;
		});
		const beat = setInterval(() => {
			if (!answered) return ws.terminate();
			answered = false;
			ws.ping();
		}, liveness.pingEvery ?? PING_EVERY_MS);
		beat.unref?.();
		ws.on("close", () => {
			clearInterval(beat);
			handlers.closed();
		});
	});
}

/** Pipes an upgrade to another daemon's socket; either end closing closes both. */
export function join(
	wss: WebSocketServer,
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer,
	upstream: WebSocket,
): void {
	accept(wss, request, socket, head, (ws) => {
		const waiting: string[] = [];
		upstream.on("open", () => {
			for (const text of waiting.splice(0)) upstream.send(text);
		});
		upstream.on("message", (data) => ws.send(String(data)));
		upstream.on("close", () => ws.close());
		upstream.on("error", () => ws.close());
		return {
			message: (text) => {
				if (upstream.readyState === upstream.OPEN) upstream.send(text);
				else waiting.push(text);
			},
			closed: () => upstream.terminate(),
		};
	});
}

// The server side of a WebSocket, taken from the `ws` package the daemon bundles. It speaks what a
// browser sends: text messages, ping and close.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";

export type { WebSocket };

/** A message larger than this closes the connection: a client sends commands, never files. */
const MAX_MESSAGE = 1024 * 1024;

/**
 * How often the server asks whether the other end is there. A socket whose peer died holds what it was
 * watching until TCP notices, which can be never on a phone that lost signal: a beat with no pong is
 * what turns that into a close, and the beat after it terminates.
 */
export const PING_EVERY_MS = 10_000;

export interface WebSocketHandlers {
	message(text: string): void;
	closed(): void;
}

/** The server that turns an upgrade request into a socket, with our limit on how big a message may be. */
export function server(): WebSocketServer {
	return new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
}

/**
 * Answers an upgrade request the caller already judged. A socket that never answered its ping is
 * terminated, so a peer that vanished does not hold what it was watching.
 */
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
		// A beat asks whether the peer is there, and the pong that answers is what lets the next one
		// through: a peer that missed a beat is terminated by the one after it.
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

/**
 * Answers an upgrade by joining it to a socket of another daemon: what one end says the other hears,
 * and either end closing closes both. What the client says before the other daemon answers waits.
 */
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

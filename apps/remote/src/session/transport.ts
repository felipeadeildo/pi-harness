// How the browser talks to the daemon: one WebSocket per attempt, on the page's own origin, which is
// the only one the daemon's `checkPlace` lets open `/ws`. The client library asks for an attempt and
// sends its hello at once, before a socket is open, so what is sent before that waits for it.
import type { ConnectionOptions, Transport } from "@adeildo/pi-remote-client";

/** The part of a WebSocket the transport uses, so a test can hand it a fake. */
export interface SocketLike {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: "open" | "close", listener: () => void): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

/** The daemon's `/ws` on the origin the page was loaded from. */
export function socketUrl(location: { protocol: string; host: string }): string {
	return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/** An `open` for `connect`: each attempt is a socket, and a close the client did not ask for is told. */
export function openSocket(url: string, socket: SocketFactory): ConnectionOptions["open"] {
	return (onMessage, onClose) => {
		const ws = socket(url);
		const waiting: string[] = [];
		let closing = false;
		ws.addEventListener("open", () => {
			for (const text of waiting.splice(0)) ws.send(text);
		});
		ws.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			let value: unknown;
			try {
				value = JSON.parse(event.data);
			} catch {
				// A line that is not JSON is not an envelope, and the client skips what does not read.
				return;
			}
			onMessage(value);
		});
		ws.addEventListener("close", () => {
			if (!closing) onClose();
		});
		const transport: Transport = {
			send(envelope) {
				const text = JSON.stringify(envelope);
				if (ws.readyState === OPEN) ws.send(text);
				else waiting.push(text);
			},
			close() {
				closing = true;
				ws.close();
			},
		};
		return transport;
	};
}

// One WebSocket per attempt on the page's own origin, the only one `checkPlace` lets open `/ws`.
// What is sent before the socket opens waits for it.
import type { ConnectionOptions, Transport } from "@adeildo/pi-remote-protocol/client";

export interface SocketLike {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: "open" | "close", listener: () => void): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

export function socketUrl(location: { protocol: string; host: string }, machine: string): string {
	const scheme = location.protocol === "https:" ? "wss" : "ws";
	return `${scheme}://${location.host}/ws?machine=${encodeURIComponent(machine)}`;
}

/** A close the client did not ask for is reported. */
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
				// Not JSON is not an envelope.
				return;
			}
			onMessage(value);
		});
		ws.addEventListener("close", () => {
			if (!closing) onClose();
		});
		const transport: Transport = {
			send(envelope) {
				// A closing socket never reopens; the client asks for a new attempt.
				if (ws.readyState > OPEN) return;
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

// What the remote's tests stand in for: a daemon that only listens and records what bridges send, in
// order, and a socket whose write buffer a test sets, to stand for a daemon that stopped reading.
import { EventEmitter } from "node:events";
import { createServer, type Socket } from "node:net";

import { HOST } from "@adeildo/pi-kit";
import { connect, memoryCache, type Client, type Transport } from "@adeildo/pi-remote-client";
import type { Envelope } from "@adeildo/pi-remote-protocol";

import { envelopeOf, Lines } from "../src/wire/lines.ts";

export interface FakeDaemon {
	/** Every envelope the bridges sent, in the order it arrived. */
	readonly received: Envelope[];
	/** The connections bridges opened, oldest first. */
	readonly sockets: Socket[];
	stop(): Promise<void>;
}

export async function fakeDaemon(path: string): Promise<FakeDaemon> {
	const received: Envelope[] = [];
	const sockets: Socket[] = [];
	const server = createServer((socket) => {
		sockets.push(socket);
		socket.setEncoding("utf8");
		const lines = new Lines();
		socket.on("data", (chunk: string) => {
			for (const text of lines.push(chunk)) {
				const envelope = envelopeOf(text);
				if (envelope !== undefined) received.push(envelope);
			}
		});
		socket.on("error", () => {});
	});
	await new Promise<void>((resolve) => server.listen(path, resolve));
	return {
		received,
		sockets,
		stop: () =>
			new Promise((resolve) => {
				for (const socket of sockets) socket.destroy();
				server.close(() => resolve());
			}),
	};
}

/** Waits until `test` holds, for at most `ms`. */
export function until(test: () => boolean, ms = 2_000): Promise<void> {
	const end = performance.now() + ms;
	const check = async (): Promise<void> => {
		if (test()) return;
		if (performance.now() > end) throw new Error("the condition never held");
		await Bun.sleep(5);
		return check();
	};
	return check();
}

export class HeldSocket extends EventEmitter {
	writableLength = 0;
	readonly written: Envelope[] = [];
	destroyed = false;
	setEncoding(): this {
		return this;
	}
	unref(): this {
		return this;
	}
	write(text: string): boolean {
		this.written.push(JSON.parse(text));
		return false;
	}
	end(text?: string): this {
		if (text !== undefined) this.write(text);
		return this.destroy();
	}
	destroy(): this {
		if (this.destroyed) return this;
		this.destroyed = true;
		queueMicrotask(() => this.emit("close"));
		return this;
	}
}

/** A dial that hands out held sockets, and the sockets it handed out, oldest first. */
export function held(): { sockets: HeldSocket[]; dial: () => Socket } {
	const sockets: HeldSocket[] = [];
	return {
		sockets,
		dial: () => {
			const socket = new HeldSocket();
			sockets.push(socket);
			return socket as unknown as Socket;
		},
	};
}

/**
 * The client library over a real WebSocket, with handles a test needs: dropping the connection the
 * way a network does, holding the reconnect, and watching the reconnect, the snapshots and the
 * deltas. A connection that went dead stops applying what already arrived, as a real socket does,
 * and a reconnect waits on `hold` so a test can let a run finish first.
 */
export function clientOf(
	session: string,
	port: () => number,
	cookie: string,
	dropAt?: string,
): {
	client: Client;
	drop(): void;
	opens(): number;
	snapshots(): number;
	/** The deltas the client read, which says the run was not instant. */
	deltas(): number;
	dropped(): boolean;
	/** Holds every connection until `release`, so a reconnect waits for the run to end. */
	hold(): void;
	release(): void;
	/** Starts dropping on the event named, so the first turns can go by untouched. */
	arm(): void;
} {
	let open: WebSocket | undefined;
	let opens = 0;
	let snapshots = 0;
	let deltas = 0;
	let dropped = false;
	let armed = false;
	let gate: Promise<void> = Promise.resolve();
	let release: () => void = () => {};
	const transport = (onMessage: (envelope: unknown) => void, onClose: () => void): Transport => {
		const queued: string[] = [];
		let ws: WebSocket | undefined;
		// Only the connection that went dead stops applying: the next one reads normally.
		let dead = false;
		void gate.then(() => {
			const at = port();
			const opened = new WebSocket(`ws://127.0.0.1:${at}/ws`, {
				// The daemon wants the login cookie on the WebSocket since C6, and the Origin with it.
				headers: { Origin: `http://127.0.0.1:${at}`, Cookie: cookie },
			});
			ws = opened;
			open = opened;
			opens += 1;
			opened.onopen = () => {
				for (const text of queued.splice(0)) opened.send(text);
			};
			opened.onmessage = (event) => {
				const message = JSON.parse(String(event.data)) as { type?: string };
				if (message.type === "snapshot") snapshots += 1;
				if (message.type === "pi.message_update") deltas += 1;
				// The network goes before the event is applied, on the first of the kind named. A delta
				// is the one the client sees live and the replay does not give back, so dropping on it
				// tells a numbered delta from one that never takes a number.
				if (dead) return;
				if (armed && message.type === dropAt && !dropped) {
					dropped = true;
					dead = true;
					opened.close();
					return;
				}
				onMessage(message);
			};
			opened.onclose = () => onClose();
		});
		return {
			send: (message) => {
				const text = JSON.stringify(message);
				if (ws?.readyState === WebSocket.OPEN) ws.send(text);
				else queued.push(text);
			},
			close: () => ws?.close(),
		};
	};
	const opened = connect({
		key: { machine: HOST, session },
		cache: memoryCache(),
		open: transport,
		backoff: { first: 20, max: 200 },
	});
	return {
		client: opened,
		drop: () => open?.close(),
		opens: () => opens,
		snapshots: () => snapshots,
		deltas: () => deltas,
		dropped: () => dropped,
		hold: () => {
			gate = new Promise((resolve) => (release = resolve));
		},
		release: () => release(),
		arm: () => {
			armed = true;
		},
	};
}

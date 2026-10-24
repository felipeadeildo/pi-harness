// What the remote's tests stand in for: a daemon that only listens and records what bridges send, in
// order, and a socket whose write buffer a test sets, to stand for a daemon that stopped reading.
import { EventEmitter } from "node:events";
import { createServer, type Socket } from "node:net";

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

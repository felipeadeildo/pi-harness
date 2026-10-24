// A daemon that only listens: it records what bridges send, so a test can read it in order.
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

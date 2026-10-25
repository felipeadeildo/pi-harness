import { describe, expect, test } from "bun:test";
// A socket-level check of the liveness ping: a real upgrade, and a client that either answers or not.
import { createServer } from "node:http";

import { WebSocket } from "ws";

import { accept, PING_EVERY_MS, server } from "../src/wire/websocket.ts";

/** A server of ours, and the promise of the close the handler sees. */
async function listening(liveness: { pingEvery: number }) {
	const wss = server();
	const http = createServer();
	const closed = Promise.withResolvers<void>();
	http.on("upgrade", (request, socket, head) => {
		accept(
			wss,
			request,
			socket,
			head,
			() => ({ message: () => {}, closed: () => closed.resolve() }),
			liveness,
		);
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
	const { port } = http.address() as { port: number };
	return {
		closed: closed.promise,
		url: `ws://127.0.0.1:${port}/ws`,
		stop: () => {
			wss.close();
			http.close();
		},
	};
}

describe("a peer that stops answering", () => {
	test("the server pings, and terminates the connection when none comes back", async () => {
		const daemon = await listening({ pingEvery: 50 });
		const client = new WebSocket(daemon.url, { autoPong: false });
		const gone = Promise.withResolvers<void>();
		client.on("close", () => gone.resolve());
		await new Promise((resolve) => client.on("open", resolve));
		await Promise.all([daemon.closed, gone.promise]);
		expect(client.readyState).toBe(WebSocket.CLOSED);
		daemon.stop();
	});
});

describe("a peer that answers", () => {
	test("it is pinged and stays connected, which is the half a dead peer cannot prove", async () => {
		const daemon = await listening({ pingEvery: 50 });
		const client = new WebSocket(daemon.url);
		let pings = 0;
		const twice = Promise.withResolvers<void>();
		client.on("ping", () => {
			pings += 1;
			if (pings === 2) twice.resolve();
		});
		await twice.promise;
		expect(client.readyState).toBe(WebSocket.OPEN);
		client.close();
		daemon.stop();
	});
});

test("a dead peer is terminated within two beats", () => {
	expect(PING_EVERY_MS).toBe(10_000);
});

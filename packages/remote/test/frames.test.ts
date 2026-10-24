import { describe, expect, test } from "bun:test";
// A socket-level check of the liveness ping: a real TCP pair, and a client that never answers.
import { createServer } from "node:net";

import { accept } from "../src/wire/websocket.ts";

describe("a peer that stops answering", () => {
	test("the server pings, waits, and closes the connection", async () => {
		const seen: string[] = [];
		const server = createServer((socket) => {
			socket.once("data", (chunk: Buffer) => {
				// The handshake comes in one read, so the same handler starts the socket.
				const request = { headers: { "sec-websocket-key": "x", upgrade: "websocket" } };
				void chunk;
				accept(
					request as never,
					socket,
					() => ({ message: () => {}, closed: () => seen.push("closed") }),
					{
						pingEvery: 20,
						pongWait: 20,
					},
				);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as { port: number };
		const client = await Bun.connect({
			hostname: "127.0.0.1",
			port,
			socket: { data: () => {}, open: () => {}, close: () => {} },
		});
		// The handshake, then nothing: no pong ever goes back.
		client.write(
			"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		const deadline = Date.now() + 2_000;
		while (seen.length === 0 && Date.now() < deadline) await Bun.sleep(10);
		expect(seen).toEqual(["closed"]);
		client.end();
		server.close();
	});
});

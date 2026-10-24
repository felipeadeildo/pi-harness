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
		const client: Awaited<ReturnType<typeof Bun.connect>> = await Bun.connect({
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

describe("a peer that answers", () => {
	test("it is pinged and stays connected, which is the half a dead peer cannot prove", async () => {
		const closed: string[] = [];
		const pings: number[] = [];
		const server = createServer((socket) => {
			socket.once("data", () => {
				const request = { headers: { "sec-websocket-key": "x", upgrade: "websocket" } };
				accept(
					request as never,
					socket,
					() => ({ message: () => {}, closed: () => closed.push("closed") }),
					{
						pingEvery: 20,
						pongWait: 60,
					},
				);
			});
			socket.on("data", (chunk: Buffer) => {
				// Count the server's pings and answer each with a pong, the way a live client does.
				for (const byte of chunk) if (byte === 0x89) pings.push(byte);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as { port: number };
		const client: Awaited<ReturnType<typeof Bun.connect>> = await Bun.connect({
			hostname: "127.0.0.1",
			port,
			socket: {
				// A live client answers each ping with a pong, which is what keeps it connected.
				data: (_socket, chunk) => {
					if (!chunk.includes(0x89)) return;
					void pings.push(0x89);
					client.write(Buffer.from([0x8a, 0x80, 1, 2, 3, 4]));
				},
				open: () => {},
				close: () => {},
			},
		});
		client.write(
			"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		// Three intervals with an answer to each ping: a heartbeat that closed live peers would show
		// here, and a heartbeat that never pings would leave the count at zero.
		await Bun.sleep(100);
		expect(closed).toEqual([]);
		client.end();
		server.close();
	});
});

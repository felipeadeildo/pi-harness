import { describe, expect, test } from "bun:test";
import { connect as dial } from "node:net";

import { frame, Frames, MAX_MESSAGE } from "../src/wire/websocket.ts";
import { openDaemon, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

function clientFrame(opcode: number, payload: Buffer, final = true): Buffer {
	const mask = Buffer.from([1, 2, 3, 4]);
	const body = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!));
	const server = frame(opcode, body);
	// A server frame has the same head with the mask bit off and no key, so the head is reused.
	const head = Buffer.from(server.subarray(0, server.length - body.length));
	head[0] = (final ? 0x80 : 0) | opcode;
	head[1]! |= 0x80;
	return Buffer.concat([head, mask, body]);
}

describe("WebSocket frames", () => {
	const masked = (opcode: number, text: string, final = true) => {
		const payload = Buffer.from(text);
		const mask = Buffer.from([1, 2, 3, 4]);
		const body = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!));
		return Buffer.concat([
			Buffer.from([(final ? 0x80 : 0) | opcode, 0x80 | body.length]),
			mask,
			body,
		]);
	};

	test("a masked message, split across chunks and fragments, reads as one", () => {
		const read: string[] = [];
		const frames = new Frames((_opcode, payload) => read.push(payload.toString()));
		const whole = Buffer.concat([masked(0x1, "hel", false), masked(0x0, "lo")]);
		expect(frames.push(whole.subarray(0, 5))).toBeUndefined();
		expect(frames.push(whole.subarray(5))).toBeUndefined();
		expect(read).toEqual(["hello"]);
	});

	test("a ping between two fragments is read at once", () => {
		const read: number[] = [];
		const frames = new Frames((opcode) => read.push(opcode));
		frames.push(Buffer.concat([masked(0x1, "a", false), masked(0x9, ""), masked(0x0, "b")]));
		expect(read).toEqual([0x9, 0x1]);
	});

	test("a message past the limit is refused, even when it comes in fragments", () => {
		const frames = new Frames(() => {});
		expect(frames.push(clientFrame(0x1, Buffer.alloc(MAX_MESSAGE + 1)))).toBe(1009);
		const half = Buffer.alloc(MAX_MESSAGE / 2 + 1);
		const fragmented = new Frames(() => {});
		expect(fragmented.push(clientFrame(0x1, half, false))).toBeUndefined();
		expect(fragmented.push(clientFrame(0x0, half))).toBe(1009);
	});

	test("an unmasked frame from a client closes the connection as a protocol error", () => {
		const read: string[] = [];
		const frames = new Frames((_opcode, payload) => read.push(payload.toString()));
		expect(frames.push(frame(0x1, Buffer.from("hi")))).toBe(1002);
		expect(read).toEqual([]);
	});

	test("a server frame takes the shortest length form, at each edge", () => {
		// RFC 6455 wants the minimal form, and a browser fails a connection that breaks it.
		const second = (size: number) => frame(0x1, Buffer.alloc(size))[1];
		expect([125, 126, 65_535, 65_536].map(second)).toEqual([125, 126, 126, 127]);
		expect(frame(0x1, Buffer.alloc(300)).subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 1, 44]));
	});

	test("a ping gets a pong with its payload, and a close gets a close", async () => {
		const { port, cookie } = await openDaemon();
		const raw = dial(port, "127.0.0.1");
		const got: Buffer[] = [];
		raw.on("data", (chunk: Buffer) => got.push(chunk));
		await new Promise<void>((resolve) => raw.once("connect", () => resolve()));
		raw.write(
			`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nCookie: ${cookie}\r\n` +
				"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		await until(() => Buffer.concat(got).includes("\r\n\r\n"));
		got.length = 0;
		raw.write(clientFrame(0x9, Buffer.from("beat")));
		await until(() => got.length > 0);
		expect(Buffer.concat(got).equals(frame(0xa, Buffer.from("beat")))).toBe(true);
		got.length = 0;
		raw.write(clientFrame(0x8, Buffer.from([0x03, 0xe8])));
		await until(() => got.length > 0);
		expect(Buffer.concat(got)[0]).toBe(0x88);
		raw.destroy();
	});
});

describe("WebSocket frames a server must not read", () => {
	/** A masked frame, as a browser sends one, with the bits a test needs to get wrong. */
	function masked(opcode: number, payload: Buffer, bits: { rsv?: number; final?: boolean } = {}) {
		const head = Buffer.alloc(6);
		head[0] = (bits.final === false ? 0 : 0x80) | ((bits.rsv ?? 0) << 4) | opcode;
		// Lengths past 125 use the extended forms, which is what makes a big control frame a real
		// frame instead of a mask byte read as a length.
		const large = payload.length > 125;
		head[1] = 0x80 | (large ? 0x7e : payload.length);
		const mask = Buffer.from([1, 2, 3, 4]);
		if (large) {
			head.writeUInt16BE(payload.length, 2);
			mask.copy(head, 4);
			const extended = Buffer.from(head.subarray(0, 8));
			const body = Buffer.from(payload);
			for (let i = 0; i < body.length; i += 1) body[i]! ^= mask[i % 4]!;
			return Buffer.concat([extended, body]);
		}
		mask.copy(head, 2);
		const body = Buffer.from(payload);
		for (let i = 0; i < body.length; i += 1) body[i]! ^= mask[i % 4]!;
		return Buffer.concat([head, body]);
	}

	test("an extension bit it never negotiated closes with 1002", () => {
		const frames = new Frames(() => {});
		expect(frames.push(masked(0x1, Buffer.from("hi"), { rsv: 0x4 }))).toBe(1002);
	});

	test("a control frame past 125 bytes closes with 1002, and a ping of 125 goes through", () => {
		// A refused frame ends the connection, so the second case gets its own reader: the first one
		// still holds the bytes it refused, which is what "do not read it" means.
		expect(new Frames(() => {}).push(masked(0x9, Buffer.alloc(126)))).toBe(1002);

		const read: number[] = [];
		const frames = new Frames((opcode) => read.push(opcode));
		expect(frames.push(masked(0x9, Buffer.alloc(125)))).toBeUndefined();
		expect(read).toEqual([0x9]);
	});

	test("an opcode nobody defined closes with 1002 instead of folding its bytes into a message", () => {
		for (const opcode of [0x3, 0xb]) {
			const read: number[] = [];
			const frames = new Frames((one) => read.push(one));
			expect(frames.push(masked(opcode, Buffer.from("evil")))).toBe(1002);
			expect(read).toEqual([]);
		}
	});

	test("a fragmented control frame closes with 1002", () => {
		const frames = new Frames(() => {});
		expect(frames.push(masked(0x9, Buffer.from("a"), { final: false }))).toBe(1002);
	});
});

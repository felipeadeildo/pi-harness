// The server side of a WebSocket, written against Node's own modules because the daemon bundle may
// import nothing else. It speaks what a browser and the native app send: text frames, ping, pong
// and close, no extensions. A client's frames are masked; the server's are not (RFC 6455).
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** A message larger than this closes the connection: a client sends commands, never files. */
export const MAX_MESSAGE = 1024 * 1024;

const TEXT = 0x1;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;
const CONTINUATION = 0x0;

export interface WebSocket {
	send(text: string): void;
	close(code?: number): void;
	/** Bytes the socket has not written yet, which tells a slow client from a quick one. */
	pending(): number;
}

export interface WebSocketHandlers {
	message(text: string): void;
	closed(): void;
}

/**
 * Answers an upgrade request, or refuses it with 400 when it is not a WebSocket handshake. The
 * handlers are given the socket once it is open.
 */
export function accept(
	request: IncomingMessage,
	socket: Duplex,
	open: (ws: WebSocket) => WebSocketHandlers,
): WebSocket | undefined {
	const key = request.headers["sec-websocket-key"];
	const upgrade = request.headers.upgrade?.toLowerCase();
	if (typeof key !== "string" || upgrade !== "websocket") {
		socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
		return undefined;
	}
	const answer = createHash("sha1")
		.update(key + GUID)
		.digest("base64");
	socket.write(
		"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
			`Sec-WebSocket-Accept: ${answer}\r\n\r\n`,
	);
	let closed = false;
	const ws: WebSocket = {
		send: (text) => {
			if (!closed) socket.write(frame(TEXT, Buffer.from(text, "utf8")));
		},
		close: (code = 1000) => {
			if (closed) return;
			closed = true;
			const body = Buffer.alloc(2);
			body.writeUInt16BE(code);
			socket.end(frame(CLOSE, body));
		},
		pending: () => ("writableLength" in socket ? (socket.writableLength as number) : 0),
	};
	const handlers = open(ws);
	const reader = new Frames((opcode, payload) => {
		if (opcode === TEXT) handlers.message(payload.toString("utf8"));
		else if (opcode === PING) socket.write(frame(PONG, payload));
		else if (opcode === CLOSE) ws.close();
	});
	socket.on("data", (chunk: Buffer) => {
		const refused = reader.push(chunk);
		if (refused !== undefined) ws.close(refused);
	});
	socket.on("error", () => socket.destroy());
	socket.on("close", () => {
		closed = true;
		handlers.closed();
	});
	return ws;
}

/** One unmasked frame, as a server sends it. */
export function frame(opcode: number, payload: Buffer): Buffer {
	const length = payload.length;
	let head: Buffer;
	if (length < 126) {
		head = Buffer.from([0x80 | opcode, length]);
	} else if (length < 65_536) {
		head = Buffer.alloc(4);
		head[0] = 0x80 | opcode;
		head[1] = 126;
		head.writeUInt16BE(length, 2);
	} else {
		head = Buffer.alloc(10);
		head[0] = 0x80 | opcode;
		head[1] = 127;
		head.writeBigUInt64BE(BigInt(length), 2);
	}
	return Buffer.concat([head, payload]);
}

/**
 * Reads a client's frames out of the chunks the socket gives, joining a fragmented message. `push`
 * returns the code to close the connection with: 1009 for a message past `MAX_MESSAGE`, and 1002 for
 * a frame a client sent unmasked, which RFC 6455 says a server must not read.
 */
export class Frames {
	#buffer: Buffer = Buffer.alloc(0);
	#parts: Buffer[] = [];
	#size = 0;
	#opcode = TEXT;
	readonly #read: (opcode: number, payload: Buffer) => void;

	constructor(read: (opcode: number, payload: Buffer) => void) {
		this.#read = read;
	}

	push(chunk: Buffer): number | undefined {
		this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
		for (;;) {
			const next = this.#next();
			if (next === "wait") return undefined;
			if (next === "too large") return 1009;
			if (next === "unmasked") return 1002;
		}
	}

	#next(): "read" | "wait" | "too large" | "unmasked" {
		const buffer = this.#buffer;
		if (buffer.length < 2) return "wait";
		const final = (buffer[0]! & 0x80) !== 0;
		const opcode = buffer[0]! & 0x0f;
		if ((buffer[1]! & 0x80) === 0) return "unmasked";
		let length = buffer[1]! & 0x7f;
		let offset = 2;
		if (length === 126) {
			if (buffer.length < 4) return "wait";
			length = buffer.readUInt16BE(2);
			offset = 4;
		} else if (length === 127) {
			if (buffer.length < 10) return "wait";
			const big = buffer.readBigUInt64BE(2);
			if (big > BigInt(MAX_MESSAGE)) return "too large";
			length = Number(big);
			offset = 10;
		}
		if (length > MAX_MESSAGE || this.#size + length > MAX_MESSAGE) return "too large";
		const mask = offset;
		offset += 4;
		if (buffer.length < offset + length) return "wait";
		const payload = Buffer.from(buffer.subarray(offset, offset + length));
		for (let i = 0; i < payload.length; i++) payload[i]! ^= buffer[mask + (i % 4)]!;
		this.#buffer = buffer.subarray(offset + length);

		// A control frame may come between the fragments of a message, and is read at once.
		if (opcode >= CLOSE) {
			this.#read(opcode, payload);
			return "read";
		}
		if (opcode !== CONTINUATION) this.#opcode = opcode;
		this.#parts.push(payload);
		this.#size += payload.length;
		if (!final) return "read";
		const message = Buffer.concat(this.#parts);
		this.#parts = [];
		this.#size = 0;
		this.#read(this.#opcode, message);
		return "read";
	}
}

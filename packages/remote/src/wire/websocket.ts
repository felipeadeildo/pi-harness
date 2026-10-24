// The server side of a WebSocket, written against Node's own modules because the daemon bundle may
// import nothing else. It speaks what a browser and the native app send: text frames, ping, pong
// and close, no extensions. A client's frames are masked; the server's are not (RFC 6455).
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** A message larger than this closes the connection: a client sends commands, never files. */
export const MAX_MESSAGE = 1024 * 1024;

/**
 * How long a connection may be quiet before the server asks whether the other end is there, and how
 * long it waits for any answer. A socket whose peer died holds what it was watching until TCP notices,
 * which can be never on a phone that lost signal: the ping is what turns that into a close.
 */
export const PING_EVERY_MS = 30_000;
export const PONG_WAIT_MS = 10_000;

const TEXT = 0x1;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;
const CONTINUATION = 0x0;
/** Every opcode RFC 6455 defines. What is not here is reserved, and a reserved frame is not ours. */
const KNOWN: ReadonlySet<number> = new Set([CONTINUATION, TEXT, CLOSE, PING, PONG]);

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
	liveness: { pingEvery?: number; pongWait?: number } = {},
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
	// The peer answered something, so it is alive: every frame counts, because a pong is only one of
	// the ways a live client speaks.
	let alive = true;
	let waiting: ReturnType<typeof setTimeout> | undefined;
	const beat = setInterval(() => {
		// The wait is always shorter than the beat (`PONG_WAIT_MS < PING_EVERY_MS`), so a peer that
		// never answers is closed by the wait below, never here: this branch only asks again.
		alive = false;
		socket.write(frame(PING, Buffer.alloc(0)));
		waiting = setTimeout(() => {
			if (!alive) ws.close(1001);
		}, liveness.pongWait ?? PONG_WAIT_MS);
		waiting.unref?.();
	}, liveness.pingEvery ?? PING_EVERY_MS);
	// A timer that keeps the process alive would keep a daemon that nobody watches from exiting.
	beat.unref?.();
	socket.on("data", (chunk: Buffer) => {
		alive = true;
		if (waiting !== undefined) {
			clearTimeout(waiting);
			waiting = undefined;
		}
		const refused = reader.push(chunk);
		if (refused !== undefined) ws.close(refused);
	});
	socket.on("error", () => socket.destroy());
	socket.on("close", () => {
		clearInterval(beat);
		if (waiting !== undefined) clearTimeout(waiting);
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
			if (next === "unmasked" || next === "rsv" || next === "control" || next === "opcode")
				return 1002;
		}
	}

	#next(): "read" | "wait" | "too large" | "unmasked" | "rsv" | "control" | "opcode" {
		const buffer = this.#buffer;
		if (buffer.length < 2) return "wait";
		const final = (buffer[0]! & 0x80) !== 0;
		const opcode = buffer[0]! & 0x0f;
		// Nothing this server negotiates sets an extension bit, so a frame that sets one is a client
		// talking a protocol we did not agree to. RFC 6455 says to fail the connection, not to guess.
		if ((buffer[0]! & 0x70) !== 0) return "rsv";
		// An opcode nobody defined is a client talking a protocol we do not know: RFC 6455 5.2 says to
		// fail the connection, and reading it as if it were text would fold its bytes into a message.
		if (!KNOWN.has(opcode)) return "opcode";
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
		// A control frame carries at most 125 bytes and is never fragmented: the rule exists so a close
		// or a ping is read without buffering, and a big one is an attack on exactly that.
		if (opcode >= CLOSE && (length > 125 || !final)) return "control";
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

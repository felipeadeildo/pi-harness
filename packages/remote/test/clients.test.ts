import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect as dial, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connect, memoryCache, type Transport } from "@adeildo/pi-remote-client";
import { envelope, type Envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { Daemon } from "../src/daemon/server.ts";
import { envelopeOf, line, Lines } from "../src/wire/lines.ts";
import { frame, Frames, MAX_MESSAGE } from "../src/wire/websocket.ts";
import { until } from "./fakes.ts";

let dir: string;
let socket: string;
const running: Daemon[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-remote-clients-"));
	socket = join(dir, "remote", "daemon.sock");
});

afterEach(() => {
	for (const daemon of running.splice(0)) daemon.stop();
	rmSync(dir, { recursive: true, force: true });
});

async function openDaemon(): Promise<{ daemon: Daemon; port: number }> {
	const daemon = await Daemon.start({ socket, version: "1.2.0", clientPort: 0 });
	if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
	running.push(daemon);
	return { daemon, port: daemon.clientPort };
}

/**
 * A bridge as the daemon sees one: a hello, `session.live`, events with a seq, and an answer to
 * `snapshot.get`, which tells whether the daemon asked for one.
 */
async function bridgeOf(session: string, epoch = "e1") {
	const at = { machine: "laptop", session, epoch };
	const client: Socket = dial(socket);
	await new Promise<void>((resolve) => client.once("connect", () => resolve()));
	const asked: Envelope[] = [];
	const lines = new Lines();
	let seq = 0;
	const send = (type: string, data: unknown) =>
		client.write(line(envelope("event", type, data, { ...at, seq: seq++ })));
	const snapshot = (entries: unknown[]) =>
		send("snapshot", {
			snapshot: { session, machine: "laptop", cwd: "/repo", kind: "terminal" },
			entries,
		});
	client.setEncoding("utf8");
	client.on("data", (chunk: string) => {
		for (const text of lines.push(chunk)) {
			const message = envelopeOf(text);
			if (message?.kind === "command") asked.push(message);
		}
	});
	client.write(line(envelope("hello", "bridge", { protocol: PROTOCOL, version: "1.2.0" }, at)));
	client.write(
		line(
			envelope(
				"event",
				"session.live",
				{ pid: 1, startedAt: 1, cwd: "/repo", kind: "terminal" },
				at,
			),
		),
	);
	return { send, snapshot, asked, close: () => client.destroy() };
}

/** The P3 client over a real WebSocket, so the daemon is held to what the app will send. */
function transportTo(port: number) {
	return (onMessage: (envelope: unknown) => void, onClose: () => void): Transport => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}` },
		});
		const queued: string[] = [];
		ws.onopen = () => {
			for (const text of queued.splice(0)) ws.send(text);
		};
		ws.onmessage = (event) => onMessage(JSON.parse(String(event.data)));
		ws.onclose = () => onClose();
		return {
			send: (message) => {
				const text = JSON.stringify(message);
				if (ws.readyState === WebSocket.OPEN) ws.send(text);
				else queued.push(text);
			},
			close: () => ws.close(),
		};
	};
}

function entry(id: string, parentId: string | null) {
	return { type: "message", id, parentId, timestamp: "", message: { role: "user", content: id } };
}

describe("a client of the daemon", () => {
	test("opens a session from the snapshot and the events after it, then follows it live", async () => {
		const { daemon, port } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		bridge.send("entry", entry("b", "a"));
		bridge.send("mode.changed", { mode: "judge" });
		await until(() => daemon.sessions.get("s1")?.facts.mode === "judge");

		const client = connect({
			key: { machine: "laptop", session: "s1" },
			cache: memoryCache(),
			open: transportTo(port),
		});
		await client.load();
		await until(() => client.session().entries.length === 2);
		expect(client.session().facts).toEqual([{ type: "mode.changed", data: { mode: "judge" } }]);

		bridge.send("entry", entry("c", "b"));
		await until(() => client.session().entries.length === 3);
		expect(client.session().cursor).toMatchObject({ epoch: "e1", seq: 3, entry: "c" });
		client.stop();
	});

	test("two sessions reach one client, and closing one keeps the other", async () => {
		const { port } = await openDaemon();
		const first = await bridgeOf("s1");
		const second = await bridgeOf("s2");
		first.snapshot([entry("a", null)]);
		second.snapshot([entry("x", null)]);
		const open = (session: string) =>
			connect({
				key: { machine: "laptop", session },
				cache: memoryCache(),
				open: transportTo(port),
			});
		const one = open("s1");
		const two = open("s2");
		await Promise.all([one.load(), two.load()]);
		await until(() => one.session().entries.length === 1 && two.session().entries.length === 1);

		first.close();
		second.send("entry", entry("y", "x"));
		await until(() => two.session().entries.length === 2);
		expect(one.session().entries.map((one) => one.id)).toEqual(["a"]);
		one.stop();
		two.stop();
	});

	test("a cursor it can resume from gets only what it missed", async () => {
		const { daemon, port } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		for (const id of ["b", "c", "d"]) bridge.send("entry", entry(id, null));
		await until(() => daemon.sessions.after("s1", { epoch: "e1", seq: 0 })?.length === 3);

		const got: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}` },
		});
		ws.onmessage = (event) => got.push(JSON.parse(String(event.data)));
		await new Promise((resolve) => (ws.onopen = resolve));
		const at = { machine: "laptop", session: "s1" };
		ws.send(JSON.stringify(envelope("hello", "hello", { cursor: { epoch: "e1", seq: 2 } }, at)));
		await until(() => got.length === 1);
		expect(got.map((one) => [one.type, one.seq])).toEqual([["entry", 3]]);
		ws.close();
	});

	test("with no snapshot to give, the daemon asks the bridge, and its answer reaches the client", async () => {
		const { port } = await openDaemon();
		const bridge = await bridgeOf("s1");
		const client = connect({
			key: { machine: "laptop", session: "s1" },
			cache: memoryCache(),
			open: transportTo(port),
		});
		await client.load();
		await until(() => bridge.asked.length === 1);
		expect(bridge.asked[0]).toMatchObject({ kind: "command", type: "snapshot.get", session: "s1" });
		bridge.snapshot([entry("a", null)]);
		await until(() => client.session().entries.length === 1);
		client.stop();
	});

	test("a client that comes before the bridge gets the session once the bridge registers it", async () => {
		const { daemon, port } = await openDaemon();
		const client = connect({
			key: { machine: "laptop", session: "s1" },
			cache: memoryCache(),
			open: transportTo(port),
		});
		await client.load();
		await until(() => daemon.watched().get("s1") === 1);
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		await until(() => client.session().entries.length === 1);
		client.stop();
		// Once nobody watches, the session leaves no entry behind.
		await until(() => daemon.watched().size === 0);
	});

	test("a snapshot carries the facts before it, without a closed question or a replaced mode", async () => {
		const { daemon, port } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.send("mode.changed", { mode: "manual" });
		bridge.send("ask.opened", { id: "q1", source: "ask-questions", questions: [] });
		bridge.send("ask.closed", { id: "q1", result: { answers: [], cancelled: true } });
		bridge.send("mode.changed", { mode: "full" });
		bridge.snapshot([]);
		// A fact after the snapshot reaches a client through the replay, not inside the snapshot.
		bridge.send("mode.changed", { mode: "judge" });
		await until(() => daemon.sessions.get("s1")?.facts.mode === "judge");

		const response = await fetch(`http://127.0.0.1:${port}/sessions/laptop/s1/snapshot`);
		const snapshot = (await response.json()) as Envelope & { data: { facts: unknown[] } };
		expect(snapshot.data.facts).toEqual([{ type: "mode.changed", data: { mode: "full" } }]);
	});

	test("the HTTP routes: health, the session list, and a snapshot only for a known machine", async () => {
		const { daemon, port } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([]);
		const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
		await until(() => daemon.sessions.get("s1")?.snapshot !== undefined);

		expect(await (await get("/health")).json()).toMatchObject({
			version: "1.2.0",
			protocol: PROTOCOL,
		});
		const list = (await (await get("/sessions")).json()) as unknown[];
		expect(list).toMatchObject([{ machine: "laptop", session: "s1", connected: true }]);
		expect((await get("/sessions/desktop/s1/snapshot")).status).toBe(404);
		expect((await get("/nowhere")).status).toBe(404);
		// A segment that does not decode is refused, and the daemon goes on answering.
		expect((await get("/sessions/laptop/%E0%A4%A/snapshot")).status).toBe(400);
		expect((await get("/sessions/laptop/s%31/snapshot")).status).toBe(200);
		expect((await get("/health")).status).toBe(200);
	});
});

describe("who reaches the daemon", () => {
	/** A raw upgrade with the headers a page would send, and the status line the daemon answers. */
	async function upgrade(port: number, headers: string): Promise<string> {
		const raw = dial(port, "127.0.0.1");
		let answer = "";
		raw.setEncoding("utf8");
		raw.on("data", (chunk: string) => (answer += chunk));
		await new Promise<void>((resolve) => raw.once("connect", () => resolve()));
		raw.write(
			`GET /ws HTTP/1.1\r\n${headers}Upgrade: websocket\r\nConnection: Upgrade\r\n` +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		await until(() => answer.includes("\r\n"));
		raw.destroy();
		return answer.slice(0, answer.indexOf("\r\n"));
	}

	test("a WebSocket from another page's Origin, or with none, is refused", async () => {
		const { port } = await openDaemon();
		const host = `Host: 127.0.0.1:${port}\r\n`;
		expect(await upgrade(port, `${host}Origin: https://evil.example\r\n`)).toBe(
			"HTTP/1.1 403 Forbidden",
		);
		expect(await upgrade(port, `${host}Origin: null\r\n`)).toStartWith("HTTP/1.1 403");
		expect(await upgrade(port, host)).toStartWith("HTTP/1.1 403");
		expect(await upgrade(port, `${host}Origin: http://localhost:${port}\r\n`)).toStartWith(
			"HTTP/1.1 101",
		);
	});

	test("a name the daemon does not answer to gets 421, so a rebound DNS name reads nothing", async () => {
		const { daemon, port } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.snapshot([entry("a", null)]);
		await until(() => daemon.sessions.get("s1")?.snapshot !== undefined);
		const status = (host: string) =>
			new Promise<number>((resolve) => {
				const raw = dial(port, "127.0.0.1");
				let answer = "";
				raw.setEncoding("utf8");
				raw.on("data", (chunk: string) => (answer += chunk));
				raw.on("close", () => resolve(Number(answer.split(" ")[1])));
				raw.write(
					`GET /sessions/laptop/s1/snapshot HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
				);
			});
		expect(await status(`attacker.example:${port}`)).toBe(421);
		expect(await status(`127.0.0.1:${port}`)).toBe(200);
		expect(
			await upgrade(
				port,
				`Host: attacker.example:${port}\r\nOrigin: http://attacker.example:${port}\r\n`,
			),
		).toStartWith("HTTP/1.1 421");
	});
});

/** A frame as a client sends it: masked, with the length form its size needs. */
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
		const { port } = await openDaemon();
		const raw = dial(port, "127.0.0.1");
		const got: Buffer[] = [];
		raw.on("data", (chunk: Buffer) => got.push(chunk));
		await new Promise<void>((resolve) => raw.once("connect", () => resolve()));
		raw.write(
			`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\n` +
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

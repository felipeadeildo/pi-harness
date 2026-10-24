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
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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
	});
});

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
		expect(frames.push(whole.subarray(0, 5))).toBe(true);
		expect(frames.push(whole.subarray(5))).toBe(true);
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
		const head = Buffer.from([0x81, 127, 0, 0, 0, 0, 0, 0, 0, 0]);
		head.writeBigUInt64BE(BigInt(MAX_MESSAGE + 1), 2);
		expect(frames.push(head)).toBe(false);
		const half = Buffer.alloc(MAX_MESSAGE / 2 + 1);
		const piece = (opcode: number, final: boolean) =>
			Buffer.concat([
				Buffer.from([(final ? 0x80 : 0) | opcode, 127, 0, 0, 0, 0, 0, 0, 0, 0]),
				half,
			]);
		const fragmented = new Frames(() => {});
		const first = piece(0x1, false);
		first.writeBigUInt64BE(BigInt(half.length), 2);
		const second = piece(0x0, true);
		second.writeBigUInt64BE(BigInt(half.length), 2);
		expect(fragmented.push(first)).toBe(true);
		expect(fragmented.push(second)).toBe(false);
	});

	test("a server frame carries its length in the form the size needs", () => {
		expect(frame(0x1, Buffer.alloc(5)).length).toBe(7);
		expect(frame(0x1, Buffer.alloc(300)).subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 1, 44]));
		expect(frame(0x1, Buffer.alloc(70_000))[1]).toBe(127);
	});
});

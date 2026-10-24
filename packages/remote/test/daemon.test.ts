import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { envelope, type Envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { BridgeConnection } from "../src/bridge/connection.ts";
import { daemonDir } from "../src/daemon/main.ts";
import { Daemon, type ExitReason, newer } from "../src/daemon/server.ts";
import { Sessions } from "../src/daemon/sessions.ts";
import { envelopeOf, line, Lines } from "../src/wire/lines.ts";
import { until } from "./fake-daemon.ts";

let dir: string;
let socket: string;
const running: Daemon[] = [];
const bridges: BridgeConnection[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-remote-daemon-"));
	socket = join(dir, "remote", "daemon.sock");
});

afterEach(async () => {
	await Promise.all(bridges.splice(0).map((opened) => opened.close()));
	for (const started of running.splice(0)) started.stop();
	rmSync(dir, { recursive: true, force: true });
});

async function openDaemon(
	options: { idleExitMs?: number; version?: string; current?: string } = {},
) {
	const exits: ExitReason[] = [];
	const started = await Daemon.start({
		socket,
		version: options.version ?? "1.2.0",
		current: options.current,
		idleExitMs: options.idleExitMs ?? 60_000,
		exited: (reason) => exits.push(reason),
	});
	if (started !== undefined) running.push(started);
	return { daemon: started, exits };
}

/** A real bridge, as pi runs it, that registers its session once the daemon answers. */
function openBridge(session: string, version = "1.2.0"): BridgeConnection {
	const opened: BridgeConnection = new BridgeConnection(
		{ path: socket, machine: "laptop", session, epoch: `${session}-1`, version },
		{
			connected() {
				opened.event("session.live", {
					pid: 4242,
					startedAt: 1,
					cwd: "/repo",
					kind: "terminal",
				});
			},
			startDaemon: () => {},
			warn: () => {},
		},
		{ backoff: [10] },
	);
	bridges.push(opened);
	opened.start();
	return opened;
}

/** A raw client on the socket, to send what a real bridge never would. */
async function raw(): Promise<{
	send(envelope: Envelope): void;
	received: Envelope[];
	closed: () => boolean;
	drop: () => void;
}> {
	const client = connect(socket);
	const received: Envelope[] = [];
	let closed = false;
	const lines = new Lines();
	client.setEncoding("utf8");
	client.on("data", (chunk: string) => {
		for (const text of lines.push(chunk)) {
			const message = envelopeOf(text);
			if (message !== undefined) received.push(message);
		}
	});
	client.on("error", () => {});
	client.on("close", () => {
		closed = true;
	});
	await new Promise<void>((resolve) => client.once("connect", () => resolve()));
	return {
		send: (message) => client.write(line(message)),
		received,
		closed: () => closed,
		drop: () => client.destroy(),
	};
}

const ORIGIN = { machine: "laptop", session: "s1", epoch: "e1" };

describe("the daemon on its socket", () => {
	test("bridges register their sessions, and closing one keeps the other", async () => {
		const { daemon: started } = await openDaemon();
		const first = openBridge("s1");
		openBridge("s2");
		await until(() => started?.sessions.connected() === 2);
		expect(started?.sessions.get("s1")).toMatchObject({ machine: "laptop", connected: true });

		await first.close("exit");
		await until(() => started?.sessions.connected() === 1);
		expect(started?.sessions.get("s1")).toMatchObject({ connected: false, gone: "exit" });
		expect(started?.sessions.get("s2")?.connected).toBe(true);
	});

	test("a bridge that loses its daemon finds the restarted one and registers again", async () => {
		const first = await openDaemon();
		openBridge("s1");
		await until(() => first.daemon?.sessions.connected() === 1);
		first.daemon?.stop();
		await until(() => first.exits.length === 1);

		const second = await openDaemon();
		await until(() => second.daemon?.sessions.connected() === 1);
		expect(second.daemon?.sessions.get("s1")?.connected).toBe(true);
	});

	test("a socket that closes without a goodbye leaves the session listed as reconnecting", async () => {
		const { daemon: started } = await openDaemon();
		const client = await raw();
		client.send(envelope("hello", "bridge", { protocol: PROTOCOL, version: "1.2.0" }, ORIGIN));
		client.send(
			envelope(
				"event",
				"session.live",
				{ pid: 1, startedAt: 1, cwd: "/", kind: "terminal" },
				ORIGIN,
			),
		);
		await until(() => started?.sessions.connected() === 1);
		client.drop();
		await until(() => started?.sessions.connected() === 0);
		expect(started?.sessions.get("s1")).toMatchObject({ connected: false });
		expect(started?.sessions.get("s1")?.gone).toBeUndefined();
	});

	test("the first message must be a bridge's hello in this protocol", async () => {
		await openDaemon();
		const cases: [Envelope, string][] = [
			[envelope("event", "session.live", {}, ORIGIN), "hello first"],
			[envelope("hello", "client", { protocol: PROTOCOL }, ORIGIN), "hello first"],
			[envelope("hello", "bridge", { protocol: 2 }, ORIGIN), "protocol 2"],
			[
				envelope("hello", "bridge", { protocol: PROTOCOL }, {}),
				"a bridge names its machine, session and epoch",
			],
		];
		for (const [hello, reason] of cases) {
			// oxlint-disable-next-line no-await-in-loop -- one client at a time, so a failure names it
			const client = await raw();
			client.send(hello);
			// oxlint-disable-next-line no-await-in-loop -- the same
			await until(client.closed);
			expect(client.received.map((message) => message.data)).toEqual([{ reason }]);
		}
	});

	test("a bridge's events count only for its own session and epoch", async () => {
		const { daemon: started } = await openDaemon();
		const live = { pid: 1, startedAt: 1, cwd: "/", kind: "terminal" };
		const other = { ...ORIGIN, session: "s2", epoch: "e2" };
		const second = await raw();
		second.send(envelope("hello", "bridge", { protocol: PROTOCOL, version: "1.2.0" }, other));
		second.send(envelope("event", "session.live", live, other));
		const client = await raw();
		client.send(envelope("hello", "bridge", { protocol: PROTOCOL, version: "1.2.0" }, ORIGIN));
		client.send(envelope("event", "session.live", live, ORIGIN));
		// The first bridge speaks for the second session, which it does not own.
		client.send(envelope("event", "mode.changed", { mode: "full" }, { ...other, seq: 0 }));
		client.send(envelope("event", "mode.changed", { mode: "judge" }, { ...ORIGIN, seq: 1 }));
		await until(() => started?.sessions.get("s1")?.facts.mode !== undefined);
		expect(started?.sessions.get("s1")?.facts.mode).toBe("judge");
		expect(started?.sessions.get("s2")?.facts.mode).toBeUndefined();
		expect(client.received[0]).toMatchObject({ kind: "hello", type: "daemon" });
	});

	test("the socket is the lock: a second daemon leaves, and a dead one's socket is taken", async () => {
		const first = await openDaemon();
		expect(first.daemon).toBeDefined();
		expect(statSync(socket).mode & 0o777).toBe(0o600);
		const second = await openDaemon();
		expect(second.daemon).toBeUndefined();

		first.daemon?.stop();
		await until(() => first.exits.length === 1);
		// What a crashed daemon leaves: a socket file nobody listens on.
		const dead = createServer();
		await new Promise<void>((resolve) => dead.listen(socket, resolve));
		await new Promise<void>((resolve) => dead.close(() => resolve()));
		writeFileSync(socket, "");
		const third = await openDaemon();
		expect(third.daemon).toBeDefined();
	});

	test("with no session connected it exits, and a session going live stops the clock", async () => {
		const quiet = await openDaemon({ idleExitMs: 50 });
		await until(() => quiet.exits.length === 1);
		expect(quiet.exits).toEqual(["idle"]);

		const busy = await openDaemon({ idleExitMs: 150 });
		openBridge("s1");
		await until(() => busy.daemon?.sessions.connected() === 1);
		await Bun.sleep(250);
		expect(busy.exits).toEqual([]);
	});

	test("a newer bridge, or a newer version in current.json, makes it exit for the upgrade", async () => {
		const byBridge = await openDaemon();
		openBridge("s1", "1.3.0");
		await until(() => byBridge.exits.length === 1);
		expect(byBridge.exits).toEqual(["upgrade"]);

		const current = join(dir, "current.json");
		writeFileSync(current, JSON.stringify({ version: "1.2.0" }));
		const byFile = await openDaemon({ current });
		writeFileSync(current, JSON.stringify({ version: "1.10.0" }));
		await until(() => byFile.exits.length === 1, 6_000);
		expect(byFile.exits).toEqual(["upgrade"]);
	});
});

describe("the replay buffer", () => {
	const live = { pid: 1, startedAt: 1, cwd: "/", kind: "terminal" as const };
	const event = (seq: number, epoch = "e1", type = "tasks.board") =>
		envelope("event", type, { n: seq }, { ...ORIGIN, epoch, seq });

	test("a cursor gets the events after it, and an ephemeral event is never kept", () => {
		const sessions = new Sessions();
		sessions.live(event(0), live);
		for (const seq of [1, 2, 3]) sessions.event(event(seq));
		sessions.event(event(4, "e1", "pi.message_update"));
		expect(sessions.after("s1", { epoch: "e1", seq: 1 })?.map((e) => e.seq)).toEqual([2, 3]);
	});

	test("a snapshot is the new base: kept for a client, and a cursor before it takes it", () => {
		const sessions = new Sessions();
		sessions.live(event(0), live);
		for (const seq of [1, 2]) sessions.event(event(seq));
		const snapshot = {
			snapshot: { session: "s1", machine: "laptop", cwd: "/", kind: "terminal" as const },
			entries: [],
		};
		sessions.event(envelope("event", "snapshot", snapshot, { ...ORIGIN, seq: 3 }));
		sessions.event(event(4));
		expect(sessions.get("s1")?.snapshot).toEqual(snapshot);
		expect(sessions.after("s1", { epoch: "e1", seq: 1 })).toBeUndefined();
		expect(sessions.after("s1", { epoch: "e1", seq: 3 })?.map((e) => e.seq)).toEqual([4]);
		sessions.event(envelope("event", "snapshot", { entries: "no" }, { ...ORIGIN, seq: 5 }));
		expect(sessions.get("s1")?.snapshot).toEqual(snapshot);
	});

	test("another epoch, or a gap the budget dropped, asks for a snapshot", () => {
		const sessions = new Sessions(JSON.stringify(event(10)).length * 2);
		sessions.live(event(0), live);
		for (const seq of [1, 2, 3, 4]) sessions.event(event(seq));
		expect(sessions.after("s1", { epoch: "e1", seq: 3 })?.map((e) => e.seq)).toEqual([4]);
		expect(sessions.after("s1", { epoch: "e1", seq: 1 })).toBeUndefined();
		expect(sessions.after("s1", { epoch: "e0", seq: 3 })).toBeUndefined();

		sessions.live(event(0, "e2"), live);
		expect(sessions.after("s1", { epoch: "e1", seq: 3 })).toBeUndefined();
		expect(sessions.after("s1", { epoch: "e2", seq: -1 })).toEqual([]);
	});
});

test("versions compare by their numbers", () => {
	expect(newer("1.10.0", "1.9.9")).toBe(true);
	expect(newer("1.2.0", "1.2.0")).toBe(false);
	expect(newer("1.2.0-dev", "1.1.0")).toBe(true);
	expect(newer("garbage", "1.0.0")).toBe(false);
});

test("the daemon finds the remote's folder as pi does, or where PI_REMOTE_DIR says", () => {
	expect(daemonDir({ PI_REMOTE_DIR: "/x" })).toBe("/x");
	expect(daemonDir({ PI_CODING_AGENT_DIR: "/agent" })).toBe("/agent/harness/remote");
});

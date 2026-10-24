import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Envelope, envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import {
	BridgeConnection,
	type ConnectionHooks,
	type ConnectionSeams,
	DROP_DELTAS_AT,
	type Origin,
	RECONNECT_AT,
	RESTART_DAEMON_MS,
} from "../src/bridge/connection.ts";
import { line } from "../src/wire/lines.ts";
import { type FakeDaemon, fakeDaemon, held, until } from "./fakes.ts";

let dir = "";
let daemon: FakeDaemon | undefined;
const opened: BridgeConnection[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pr-"));
});

afterEach(async () => {
	await Promise.all(opened.splice(0).map((one) => one.close()));
	await daemon?.stop();
	daemon = undefined;
	rmSync(dir, { recursive: true, force: true });
});

function origin(): Origin {
	return {
		path: join(dir, "daemon.sock"),
		machine: "laptop",
		session: "s1",
		epoch: "e1",
		version: "9.9.9",
	};
}

interface Heard {
	connected: number;
	resyncs: number;
	messages: Envelope[];
	warnings: string[];
	daemonStarts: number;
}

/** A connection whose hooks only count, with a fast retry unless the test says otherwise. */
function connection(hooks: Partial<ConnectionHooks> = {}, seams: Partial<ConnectionSeams> = {}) {
	const heard: Heard = { connected: 0, resyncs: 0, messages: [], warnings: [], daemonStarts: 0 };
	const made = new BridgeConnection(
		origin(),
		{
			connected: () => {
				heard.connected += 1;
			},
			resync: () => {
				heard.resyncs += 1;
			},
			message: (message) => heard.messages.push(message),
			startDaemon: () => {
				heard.daemonStarts += 1;
			},
			warn: (message) => heard.warnings.push(message),
			...hooks,
		},
		{ backoff: [5], ...seams },
	);
	opened.push(made);
	return { made, heard };
}

describe("a bridge and its daemon", () => {
	test("the bridge greets with the protocol, its version and the epoch, then hands over", async () => {
		const listening = await fakeDaemon(origin().path);
		daemon = listening;
		const { made, heard } = connection();
		made.start();
		await until(() => heard.connected === 1);
		expect(made.up).toBe(true);
		expect(made.event("session.live", { pid: 1 })).toBe(true);
		await until(() => listening.received.length === 2);
		const [hello, live] = listening.received;
		expect(hello).toMatchObject({
			kind: "hello",
			type: "bridge",
			machine: "laptop",
			session: "s1",
			epoch: "e1",
			data: { protocol: PROTOCOL, version: "9.9.9" },
		});
		expect(hello?.seq).toBeUndefined();
		expect(live).toMatchObject({ kind: "event", type: "session.live", epoch: "e1", seq: 0 });
	});

	test("events keep their numbers in the epoch across a reconnect, and each connection is greeted", async () => {
		const listening = await fakeDaemon(origin().path);
		daemon = listening;
		const { made, heard } = connection();
		made.start();
		await until(() => heard.connected === 1);
		made.event("first", {});
		await until(() => listening.received.length === 2);
		listening.sockets[0]?.destroy();
		await until(() => heard.connected === 2);
		made.event("second", {});
		await until(() => listening.received.length === 4);
		expect(listening.received.map((one) => [one.kind, one.type, one.seq])).toEqual([
			["hello", "bridge", undefined],
			["event", "first", 0],
			["hello", "bridge", undefined],
			["event", "second", 1],
		]);
		expect(heard.daemonStarts).toBe(0);
	});

	test("with nothing answering, it starts the daemon at most once in ten seconds, and connects when one listens", async () => {
		let now = 0;
		let dials = 0;
		const { made, heard } = connection(
			{},
			{
				dial: (path) => {
					dials += 1;
					return connect(path);
				},
				now: () => now,
			},
		);
		made.start();
		await until(() => dials >= 4);
		expect(heard.daemonStarts).toBe(1);
		expect(made.event("lost", {})).toBe(false);
		now = RESTART_DAEMON_MS;
		const seen = dials;
		// A new dial follows only a handled failure, so two more prove one failed after the clock moved.
		await until(() => dials > seen + 1);
		expect(heard.daemonStarts).toBe(2);
		daemon = await fakeDaemon(origin().path);
		await until(() => heard.connected === 1);
		expect(heard.daemonStarts).toBe(2);
	});

	test("a message from the daemon reaches the bridge, and a line that is not an envelope does not", async () => {
		const listening = await fakeDaemon(origin().path);
		daemon = listening;
		const { made, heard } = connection();
		made.start();
		await until(() => heard.connected === 1 && listening.sockets.length === 1);
		listening.sockets[0]?.write(
			`not json\n{"v":1}\n${line(envelope("command", "snapshot.get", {}, { id: "c1" }))}`,
		);
		await until(() => heard.messages.length === 1);
		await Bun.sleep(20);
		expect(heard.messages.map((message) => [message.type, message.id])).toEqual([
			["snapshot.get", "c1"],
		]);
		// Two lines it cannot read, and one warning with the start of the first.
		expect(heard.warnings).toEqual([
			"the pi-remote daemon sent a line this bridge cannot read: not json",
		]);
	});

	test("a request gets the reply that carries its id, and other messages still reach the bridge", async () => {
		const listening = await fakeDaemon(origin().path);
		daemon = listening;
		const { made, heard } = connection();
		made.start();
		await until(() => heard.connected === 1);
		const asked = made.request("token.issue", {});
		await until(() => listening.received.some((one) => one.kind === "command"));
		const command = listening.received.find((one) => one.kind === "command");
		expect(command).toMatchObject({ type: "token.issue", session: "s1", epoch: "e1" });
		const socket = listening.sockets[0];
		socket?.write(line(envelope("command", "snapshot.get", {}, { id: "other" })));
		socket?.write(line(envelope("reply", "token.issue", { token: "t" }, { id: command?.id })));
		expect((await asked)?.data).toEqual({ token: "t" });
		await until(() => heard.messages.length === 1);
		expect(heard.messages.map((one) => one.type)).toEqual(["snapshot.get"]);
	});

	test("a request with no daemon, no reply or a lost socket comes back with nothing", async () => {
		const unanswered = connection();
		expect(await unanswered.made.request("token.issue", {})).toBeUndefined();
		const listening = await fakeDaemon(origin().path);
		daemon = listening;
		const { made, heard } = connection();
		made.start();
		await until(() => heard.connected === 1);
		expect(await made.request("token.issue", {}, 20)).toBeUndefined();
		const lost = made.request("token.issue", {});
		await until(() => listening.received.filter((one) => one.kind === "command").length === 2);
		listening.sockets[0]?.destroy();
		expect(await lost).toBeUndefined();
	});

	test("closing tells the daemon the session is gone, and nothing connects again", async () => {
		const listening = await fakeDaemon(origin().path);
		daemon = listening;
		const { made, heard } = connection();
		made.start();
		await until(() => heard.connected === 1);
		await made.close("replaced");
		await until(() => listening.received.length === 2);
		expect(listening.received[1]).toMatchObject({
			type: "session.gone",
			data: { reason: "replaced" },
			seq: 0,
		});
		expect(made.up).toBe(false);
		await Bun.sleep(30);
		expect(listening.sockets.length).toBe(1);
	});

	test("closing with no reason, as on a reload, ends the socket and says nothing more", async () => {
		const listening = await fakeDaemon(origin().path);
		daemon = listening;
		const { made, heard } = connection();
		made.start();
		await until(() => heard.connected === 1);
		await made.close();
		await Bun.sleep(30);
		expect(listening.received.map((one) => one.type)).toEqual(["bridge"]);
	});
});

describe("a daemon that stops reading", () => {
	test("past a megabyte waiting, deltas are dropped, facts still go, and a drain asks for one resync", () => {
		const { sockets, dial } = held();
		const { made, heard } = connection({}, { dial });
		made.start();
		const [socket] = sockets;
		if (socket === undefined) throw new Error("no socket");
		socket.emit("connect");
		expect(made.event("pi.message_update", { n: 1 }, { droppable: true })).toBe(true);
		socket.writableLength = DROP_DELTAS_AT + 1;
		expect(made.event("pi.message_update", { n: 2 }, { droppable: true })).toBe(false);
		expect(made.event("tasks.changed", {})).toBe(true);
		socket.writableLength = 0;
		socket.emit("drain");
		socket.emit("drain");
		expect(heard.resyncs).toBe(1);
		// The dropped delta took no number, so the daemon sees no gap.
		expect(socket.written.map((one) => [one.type, one.seq])).toEqual([
			["bridge", undefined],
			["pi.message_update", 0],
			["tasks.changed", 1],
		]);
	});

	test("past eight megabytes waiting, it drops the socket and opens a new one, greeted again", async () => {
		const { sockets, dial } = held();
		const { made, heard } = connection({}, { dial });
		made.start();
		const [first] = sockets;
		if (first === undefined) throw new Error("no socket");
		first.emit("connect");
		first.writableLength = RECONNECT_AT + 1;
		expect(made.event("tasks.changed", {})).toBe(false);
		expect(first.destroyed).toBe(true);
		await until(() => sockets.length === 2);
		sockets[1]?.emit("connect");
		expect(heard.connected).toBe(2);
		expect(sockets[1]?.written[0]?.kind).toBe("hello");
		// The daemon answered before, so this is no reason to start another one.
		expect(heard.daemonStarts).toBe(0);
	});

	test("a socket destroyed before its close arrives takes no event, and says so", () => {
		const { sockets, dial } = held();
		const { made } = connection({}, { dial });
		made.start();
		const [socket] = sockets;
		if (socket === undefined) throw new Error("no socket");
		socket.emit("connect");
		socket.destroyed = true;
		expect(made.event("tasks.changed", {})).toBe(false);
		expect(socket.written.map((one) => one.type)).toEqual(["bridge"]);
		socket.emit("close");
	});

	test("a warning that throws too, as from a runtime pi let go of, stays inside", () => {
		const { sockets, dial } = held();
		const { made } = connection(
			{
				connected: () => {
					throw new Error("boom");
				},
				warn: () => {
					throw new Error("stale");
				},
			},
			{ dial },
		);
		made.start();
		expect(() => sockets[0]?.emit("connect")).not.toThrow();
	});

	test("a hook that throws becomes a warning, and the connection goes on", () => {
		const { sockets, dial } = held();
		const { made, heard } = connection(
			{
				connected: () => {
					throw new Error("boom");
				},
			},
			{ dial },
		);
		made.start();
		expect(() => sockets[0]?.emit("connect")).not.toThrow();
		expect(heard.warnings).toEqual(["the remote bridge failed: boom"]);
		expect(made.event("tasks.changed", {})).toBe(true);
	});
});

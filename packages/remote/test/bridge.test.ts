import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, HOST } from "@adeildo/pi-kit";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { type FakePi, fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import { envelope } from "@adeildo/pi-remote-protocol";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { SNAPSHOT_ENTRIES } from "../src/bridge/bridge.ts";
import piRemote, { daemonSocket, goneReason, remote, sessionKind } from "../src/index.ts";
import { VERSION } from "../src/version.ts";
import { line } from "../src/wire/lines.ts";
import { type FakeDaemon, fakeDaemon, until } from "./fake-daemon.ts";

let root = "";
/** The daemon the current test listens with, stopped after it. */
let open: FakeDaemon | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pr-"));
	process.env.PI_REMOTE_DIR = root;
});

afterEach(async () => {
	delete process.env.PI_REMOTE_DIR;
	delete process.env.PI_REMOTE_SHARE;
	await open?.stop();
	open = undefined;
	rmSync(root, { recursive: true, force: true });
});

async function listening(): Promise<FakeDaemon> {
	open = await fakeDaemon(daemonSocket(root));
	return open;
}

function mounted(): FakePi {
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(root, "settings.json") })
		.use(remote)
		.build();
	return fake;
}

interface Entry {
	type: string;
	id: string;
	parentId: string | null;
}

function entries(count: number): Entry[] {
	return Array.from({ length: count }, (_, at) => ({
		type: "message",
		id: `e${at + 1}`,
		parentId: at === 0 ? null : `e${at}`,
	}));
}

/** A session pi titled, with the entries given, in a terminal unless `mode` says otherwise. */
function session(held: Entry[] = entries(2), mode = "tui") {
	const ctx = fakeContext([], mode === "tui", {
		mode,
		cwd: "/work",
		model: { provider: "rig", id: "scripted" },
		thinkingLevel: "high",
		getContextUsage: () => ({ tokens: 1_200, contextWindow: 200_000, percent: 0.6 }),
		sessionManager: {
			getSessionId: () => "s1",
			getSessionName: () => "Fix the release",
			getEntries: () => held,
			getBranch: () => held,
			getLeafId: () => held.at(-1)?.id ?? null,
		},
	});
	return ctx;
}

async function start(fake: FakePi, ctx = session()): Promise<void> {
	await fake.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
}

async function stop(fake: FakePi, reason: string): Promise<void> {
	await fake.fire("session_shutdown", { type: "session_shutdown", reason }, session());
}

function types(daemon: FakeDaemon): string[] {
	return daemon.received.map((one) => one.type);
}

describe("the bridge", () => {
	test("a session in a terminal writes the launcher, says it is live, then sends a snapshot", async () => {
		const daemon = await listening();
		const fake = mounted();
		await start(fake);
		await until(() => daemon.received.length === 3);
		expect(JSON.parse(readFileSync(join(root, "current.json"), "utf8")).version).toBe(VERSION);
		const [hello, live, snapshot] = daemon.received;
		expect(hello).toMatchObject({ kind: "hello", machine: HOST, session: "s1" });
		expect(live).toMatchObject({
			type: "session.live",
			seq: 0,
			data: { pid: process.pid, cwd: "/work", name: "Fix the release", kind: "terminal" },
		});
		expect(snapshot).toMatchObject({
			type: "snapshot",
			seq: 1,
			data: {
				snapshot: {
					session: "s1",
					machine: HOST,
					cwd: "/work",
					name: "Fix the release",
					leaf: "e2",
					model: { provider: "rig", id: "scripted" },
					thinkingLevel: "high",
					context: { tokens: 1_200, window: 200_000 },
					kind: "terminal",
				},
				entries: entries(2),
			},
		});
		await stop(fake, "quit");
		await until(() => types(daemon).includes("session.gone"));
		expect(daemon.received.at(-1)).toMatchObject({ data: { reason: "exit" } });
	});

	test("after the snapshot, each entry pi appends goes out once", async () => {
		const daemon = await listening();
		const held = entries(2);
		const fake = mounted();
		const ctx = session(held);
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		held.push({ type: "message", id: "e3", parentId: "e2" });
		await fake.fire("turn_end", { type: "turn_end", messageEntryId: "e3" }, ctx);
		await until(() => types(daemon).includes("entry"));
		await fake.fire("turn_end", { type: "turn_end", messageEntryId: "e3" }, ctx);
		await Bun.sleep(20);
		expect(daemon.received.filter((one) => one.type === "entry").map((one) => one.data)).toEqual([
			{ type: "message", id: "e3", parentId: "e2" },
		]);
	});

	test("a snapshot carries the end of the branch, and goes out again when the daemon asks", async () => {
		const daemon = await listening();
		await start(mounted(), session(entries(SNAPSHOT_ENTRIES + 10)));
		await until(() => types(daemon).includes("snapshot"));
		daemon.sockets[0]?.write(line(envelope("command", "snapshot.get", {})));
		await until(() => types(daemon).filter((type) => type === "snapshot").length === 2);
		const snapshots = daemon.received.filter((one) => one.type === "snapshot");
		for (const one of snapshots) {
			const tail = (one.data as { entries: Entry[] }).entries;
			expect(tail).toHaveLength(SNAPSHOT_ENTRIES);
			expect(tail.at(-1)?.id).toBe(`e${SNAPSHOT_ENTRIES + 10}`);
		}
	});

	test("pi -p writes nothing and connects to nothing", async () => {
		const daemon = await listening();
		await start(mounted(), session(entries(2), "print"));
		await Bun.sleep(30);
		expect(daemon.sockets).toEqual([]);
		expect(() => statSync(join(root, "current.json"))).toThrow();
	});

	test("an RPC session shows only when its starter shares it, as a background one", () => {
		expect(sessionKind("tui")).toBe("terminal");
		expect(sessionKind("rpc")).toBeUndefined();
		expect(sessionKind("json")).toBeUndefined();
		process.env.PI_REMOTE_SHARE = "1";
		expect(sessionKind("rpc")).toBe("background");
		expect(sessionKind("print")).toBeUndefined();
	});

	test("each runtime is a new epoch, and a reload ends the old one without saying the session is gone", async () => {
		const daemon = await listening();
		const before = mounted();
		await start(before);
		await until(() => daemon.received.length === 3);
		await stop(before, "reload");
		const after = mounted();
		await start(after);
		await until(() => daemon.received.length === 6);
		await stop(after, "new");
		await until(() => daemon.received.length === 7);
		expect(types(daemon)).toEqual([
			"bridge",
			"session.live",
			"snapshot",
			"bridge",
			"session.live",
			"snapshot",
			"session.gone",
		]);
		expect(daemon.received[0]?.epoch).not.toBe(daemon.received[3]?.epoch);
		expect(daemon.received[6]).toMatchObject({
			epoch: daemon.received[3]?.epoch,
			data: { reason: "replaced" },
		});
	});

	test("the end of a session reads as the daemon shows it", () => {
		expect(goneReason("quit")).toBe("exit");
		expect(goneReason("reload")).toBeUndefined();
		for (const reason of ["new", "resume", "fork"] as const) {
			expect(goneReason(reason)).toBe("replaced");
		}
	});
});

describe("a real pi session", () => {
	let rig: Rig | undefined;
	afterEach(() => {
		rig?.dispose();
		rig = undefined;
	});

	test("the answer streams under a number, and the turn's end binds it to the entry that follows", async () => {
		const daemon = await listening();
		process.env.PI_REMOTE_SHARE = "1";
		rig = await createRig({
			extensions: [piRemote],
			answer: () => fauxAssistantMessage("Hello from the scripted model."),
		});
		await until(() => types(daemon).includes("snapshot"));
		await rig.prompt("say hello");
		await until(() => types(daemon).includes("stream.bound"));
		const bound = daemon.received.find((one) => one.type === "stream.bound")?.data as
			| { messages: { stream: number; entry: string }[] }
			| undefined;
		const pair = bound?.messages[0];
		if (pair === undefined) throw new Error("no message was bound to an entry");
		await until(() =>
			daemon.received.some(
				(one) => one.type === "entry" && (one.data as { id: string }).id === pair.entry,
			),
		);
		const streamed = daemon.received.filter((one) => one.type.startsWith("pi.message_"));
		expect(streamed[0]).toMatchObject({ type: "pi.message_start", data: { stream: pair.stream } });
		expect(streamed.at(-1)).toMatchObject({
			type: "pi.message_end",
			data: { stream: pair?.stream },
		});
		// Every event of the run keeps its place in the epoch.
		const seqs = daemon.received.filter((one) => one.kind === "event").map((one) => one.seq);
		expect(seqs).toEqual(seqs.map((_, at) => at));
		expect(daemon.received[1]?.data).toMatchObject({ kind: "background" });
	});
});

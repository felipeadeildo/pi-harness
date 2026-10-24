import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createApp,
	emptyTasks,
	HOST,
	LOGGED_EVENT,
	logEvent,
	logPath,
	MODE,
	protectedList,
	TASKS,
	targetOf,
} from "@adeildo/pi-kit";
import { ANSWER, ASK, CANCEL } from "@adeildo/pi-kit";
import type { SessionSource, SourceItem } from "@adeildo/pi-kit";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { type FakePi, fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import { envelope } from "@adeildo/pi-remote-protocol";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { MessageStartEvent, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

import { Bridge, SNAPSHOT_ENTRIES } from "../src/bridge/bridge.ts";
import piRemote, { goneReason, remote, sessionKind } from "../src/index.ts";
import { CLIENT_PORT, daemonPaths } from "../src/places.ts";
import { VERSION } from "../src/version.ts";
import { line } from "../src/wire/lines.ts";
import { type FakeDaemon, fakeDaemon, held, until } from "./fakes.ts";

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
	open = await fakeDaemon(daemonPaths(root).socket);
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

/**
 * A session pi titled, with the entries given and the branch through them, in a terminal unless
 * `mode` says otherwise.
 */
function session(kept: Entry[] = entries(2), mode = "tui", branch: Entry[] = kept) {
	const ctx = fakeContext([], mode === "tui", {
		mode,
		cwd: "/work",
		model: { provider: "rig", id: "scripted" },
		thinkingLevel: "high",
		getContextUsage: () => ({ tokens: 1_200, contextWindow: 200_000, percent: 0.6 }),
		sessionManager: {
			getSessionId: () => "s1",
			getSessionName: () => "Fix the release",
			getSessionFile: () => "/sessions/s1.jsonl",
			getEntries: () => kept,
			getBranch: () => branch,
			getLeafId: () => kept.at(-1)?.id ?? null,
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
			data: {
				pid: process.pid,
				cwd: "/work",
				name: "Fix the release",
				kind: "terminal",
				file: "/sessions/s1.jsonl",
			},
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

	test("a command from a daemon runs in the session and is answered on the same id", async () => {
		const daemon = await listening();
		process.env.PI_HARNESS_EVENTS = join(root, "events");
		const compacted: string[] = [];
		const fake = mounted();
		const ctx = fakeContext([], true, {
			...session(),
			compact: (options?: { customInstructions?: string }) =>
				compacted.push(options?.customInstructions ?? ""),
			sessionManager: {
				getCwd: () => root,
				getSessionId: () => "s1",
				getSessionName: () => "Fix the release",
				getSessionFile: () => "/sessions/s1.jsonl",
				getEntries: () => entries(2),
				getBranch: () => entries(2),
				getLeafId: () => "e2",
			},
		});
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		const by = { kind: "client", name: "phone", machine: HOST } as const;
		const at = { machine: HOST, session: "s1", epoch: "e1", id: "c1", by };
		daemon.sockets[0]?.write(
			line(envelope("command", "session.compact", { instructions: "keep the plan" }, at)),
		);
		await until(() => daemon.received.some((one) => one.kind === "reply"));
		expect(compacted).toEqual(["keep the plan"]);
		expect(daemon.received.find((one) => one.kind === "reply")).toMatchObject({
			type: "session.compact",
			id: "c1",
		});
		// The id is in the session's log, so a resend after a restart is still a repeat.
		const log = readFileSync(
			logPath(targetOf({ getCwd: () => root, getSessionId: () => "s1" })),
			"utf8",
		);
		expect(log).toContain('"command.received"');
		expect(log).toContain('"c1"');
		await stop(fake, "quit");
		delete process.env.PI_HARNESS_EVENTS;
	});

	test("a follow-up waits for the agent to settle, and then pi gets it", async () => {
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		const by = { kind: "client", name: "phone", machine: HOST } as const;
		daemon.sockets[0]?.write(
			line(
				envelope(
					"command",
					"prompt.send",
					{ text: "one more thing" },
					{
						machine: HOST,
						session: "s1",
						epoch: "e1",
						id: "p1",
						by,
					},
				),
			),
		);
		await until(() => daemon.received.some((one) => one.kind === "reply" && one.id === "p1"));
		// It waits: nothing has reached pi while the agent has not settled.
		expect(fake.userMessages).toEqual([]);
		await fake.fire("agent_settled", { type: "agent_settled", aborted: false }, ctx);
		await until(() => fake.userMessages.length === 1);
		expect(fake.userMessages).toEqual(["one more thing"]);
		await stop(fake, "quit");
	});

	test("a thinking level from a client reaches pi, and one pi does not know is refused", async () => {
		const daemon = await listening();
		const fake = mounted();
		await start(fake);
		await until(() => types(daemon).includes("snapshot"));
		const by = { kind: "client", name: "phone", machine: HOST } as const;
		const at = { machine: HOST, session: "s1", epoch: "e1", by };
		const send = (id: string, level: string) =>
			daemon.sockets[0]?.write(line(envelope("command", "thinking.set", { level }, { ...at, id })));
		send("c1", "max");
		await until(() => daemon.received.some((one) => one.kind === "reply"));
		expect(fake.thinkingLevel).toBe("max");
		send("c2", "turbo");
		await until(() => daemon.received.some((one) => one.kind === "error"));
		expect(daemon.received.find((one) => one.kind === "error")).toMatchObject({
			type: "thinking.set",
			id: "c2",
			data: {
				reason: "turbo is not a thinking level: off, minimal, low, medium, high, xhigh, max",
			},
		});
		await stop(fake, "quit");
	});

	test("a client's answer reaches the bus with its own by, and a closed question is refused", async () => {
		const daemon = await listening();
		const fake = mounted();
		const answered: { id: string; by?: unknown; result: unknown }[] = [];
		fake.pi.events.on(ANSWER, (data: unknown) => answered.push(data as never));
		await start(fake);
		await until(() => types(daemon).includes("snapshot"));

		const by = { kind: "client", name: "my phone", machine: "phone" } as const;
		const at = { machine: HOST, session: "s1", epoch: "e1", by };
		const answer = (id: string, ask: string, result: unknown) =>
			daemon.sockets[0]?.write(
				line(envelope("command", "ask.answer", { ask, result }, { ...at, id })),
			);
		const errors = () => daemon.received.filter((one) => one.kind === "error");

		fake.pi.events.emit(ASK, { id: "q1", questions: [] });
		answer("c1", "q1", { answers: [], cancelled: false });
		await until(() => answered.length === 1);
		// The client's own name travels to the bus; the bridge does not invent one.
		expect(answered[0]).toEqual({ id: "q1", by, result: { answers: [], cancelled: false } });

		// The question is closed now, so a second answer is refused with its id, not counted.
		answer("c2", "q1", { answers: [], cancelled: false });
		await until(() => errors().length === 1);
		expect(errors()[0]?.data).toEqual({ reason: "the question q1 was answered somewhere else" });

		// A result that does not read is refused too: it would reach an extension as a decision.
		fake.pi.events.emit(ASK, { id: "q2", questions: [] });
		answer("c3", "q2", { answers: "none", cancelled: false });
		await until(() => errors().length === 2);
		expect(errors()[1]?.data).toEqual({ reason: "an answer needs `answers` and `cancelled`" });

		// An answer that does not say who gave it is refused, not logged under a name nobody has.
		fake.pi.events.emit(ASK, { id: "q3", questions: [] });
		daemon.sockets[0]?.write(
			line(
				envelope(
					"command",
					"ask.answer",
					{ ask: "q3", result: { answers: [], cancelled: false } },
					{ machine: HOST, session: "s1", epoch: "e1", id: "c4" },
				),
			),
		);
		await until(() => errors().length === 3);
		expect(errors()[2]?.data).toEqual({ reason: "an answer names who gave it" });
	});

	test("a stop cancels the questions still open, before it aborts the run", async () => {
		const daemon = await listening();
		const order: string[] = [];
		const ctx = fakeContext([], true, {
			...session(),
			abort: () => order.push("abort"),
			shutdown: () => order.push("shutdown"),
		});
		const fake = mounted();
		fake.pi.events.on(CANCEL, (data: unknown) =>
			order.push(`cancel:${String(data && (data as { id: string }).id)}`),
		);
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));

		// One question is waiting; another was answered, so the stop has nothing to say about it.
		fake.pi.events.emit(ASK, { id: "waiting", questions: [] });
		fake.pi.events.emit(ASK, { id: "answered", questions: [] });
		fake.pi.events.emit(ANSWER, { id: "answered", result: { answers: [] } });

		const by = { kind: "client", name: "phone", machine: HOST } as const;
		const at = { machine: HOST, session: "s1", epoch: "e1", by };
		daemon.sockets[0]?.write(line(envelope("command", "session.stop", {}, { ...at, id: "c1" })));
		await until(() => order.includes("shutdown"));
		// The cancel goes first: an extension waiting on the question hears "no", not the shutdown.
		expect(order).toEqual(["cancel:waiting", "abort", "shutdown"]);
	});

	test("a forced stop is refused with a reason, and the log says which command and why", async () => {
		const daemon = await listening();
		process.env.PI_HARNESS_EVENTS = join(root, "events");
		const fake = mounted();
		const stopped: string[] = [];
		const ctx = fakeContext([], true, {
			...session(),
			abort: () => stopped.push("abort"),
			shutdown: () => stopped.push("shutdown"),
			sessionManager: {
				getCwd: () => root,
				getSessionId: () => "s1",
				getSessionName: () => "Fix the release",
				getSessionFile: () => "/sessions/s1.jsonl",
				getEntries: () => entries(2),
				getBranch: () => entries(2),
				getLeafId: () => "e2",
			},
		});
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		const by = { kind: "client", name: "phone", machine: HOST } as const;
		const at = { machine: HOST, session: "s1", epoch: "e1", by };
		daemon.sockets[0]?.write(
			line(envelope("command", "session.stop", { force: true }, { ...at, id: "c1" })),
		);
		await until(() => daemon.received.some((one) => one.kind === "error"));
		expect(stopped).toEqual([]);
		expect(daemon.received.find((one) => one.kind === "error")).toMatchObject({
			type: "session.stop",
			id: "c1",
			data: { reason: "a forced stop needs a background session, which has a runner" },
		});
		const log = readFileSync(
			logPath(targetOf({ getCwd: () => root, getSessionId: () => "s1" })),
			"utf8",
		);
		// One line for the command before it ran, and one for how it ended: a `ran` command leaves one.
		expect(log).toContain('"command.received"');
		expect(log).toContain('"command.outcome"');
		expect(log).toContain('"refused"');
		await stop(fake, "quit");
		delete process.env.PI_HARNESS_EVENTS;
	});

	test("a command id from an earlier run of the session is a repeat after the bridge restarts", async () => {
		const daemon = await listening();
		process.env.PI_HARNESS_EVENTS = join(root, "events");
		const compacted: string[] = [];
		const fake = mounted();
		const ctx = fakeContext([], true, {
			...session(),
			compact: () => compacted.push("ran"),
			sessionManager: {
				getCwd: () => root,
				getSessionId: () => "s1",
				getSessionName: () => "Fix the release",
				getSessionFile: () => "/sessions/s1.jsonl",
				getEntries: () => entries(2),
				getBranch: () => entries(2),
				getLeafId: () => "e2",
			},
		});
		// The earlier run of this session logged the command before the bridge that ran it went away.
		logEvent(
			targetOf({ getCwd: () => root, getSessionId: () => "s1" }),
			undefined,
			"command.received",
			{ id: "before", command: "session.compact" },
		);
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		const by = { kind: "client", name: "phone", machine: HOST } as const;
		const at = { machine: HOST, session: "s1", epoch: "e1", by };
		daemon.sockets[0]?.write(
			line(envelope("command", "session.compact", {}, { ...at, id: "before" })),
		);
		await until(() => daemon.received.some((one) => one.kind === "reply"));
		expect(compacted).toEqual([]);
		expect(daemon.received.find((one) => one.kind === "reply")?.data).toEqual({ repeat: true });
		await stop(fake, "quit");
		delete process.env.PI_HARNESS_EVENTS;
	});

	test("after the snapshot, each entry pi appends goes out once", async () => {
		const daemon = await listening();
		const kept = entries(2);
		const fake = mounted();
		const ctx = session(kept);
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		kept.push({ type: "message", id: "e3", parentId: "e2" });
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

	test("a move in the tree names the new leaf, the root included", async () => {
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		await fake.fire(
			"session_tree",
			{ type: "session_tree", newLeafId: "e1", oldLeafId: "e2" },
			ctx,
		);
		await fake.fire(
			"session_tree",
			{ type: "session_tree", newLeafId: null, oldLeafId: "e1" },
			ctx,
		);
		await until(() => types(daemon).filter((type) => type === "leaf.changed").length === 2);
		expect(
			daemon.received.filter((one) => one.type === "leaf.changed").map((one) => one.data),
		).toEqual([{ leaf: "e1" }, { leaf: null }]);
	});

	test("after a reconnect, each entry pi appends still goes out once", async () => {
		const daemon = await listening();
		const kept = entries(2);
		const fake = mounted();
		const ctx = session(kept);
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		daemon.sockets[0]?.destroy();
		await until(() => types(daemon).filter((type) => type === "snapshot").length === 2, 3_000);
		kept.push({ type: "message", id: "e3", parentId: "e2" });
		await fake.fire("turn_end", { type: "turn_end", messageEntryId: "e3" }, ctx);
		await until(() => types(daemon).includes("entry"));
		await Bun.sleep(30);
		expect(types(daemon).filter((type) => type === "entry")).toHaveLength(1);
	});

	test("the snapshot carries the branch, not every entry the session holds", async () => {
		const daemon = await listening();
		const all = [...entries(2), { type: "message", id: "x9", parentId: "e1" }];
		await start(mounted(), session(all, "tui", entries(2)));
		await until(() => types(daemon).includes("snapshot"));
		const snapshot = daemon.received.find((one) => one.type === "snapshot")?.data as
			| { entries: Entry[] }
			| undefined;
		expect(snapshot?.entries).toEqual(entries(2));
	});

	test("a change of model, thinking or name, and a running tool's output, each go out", async () => {
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		const model = { provider: "rig", id: "other" };
		await fake.fire("model_select", { type: "model_select", model, source: "set" }, ctx);
		await fake.fire("thinking_level_select", { type: "thinking_level_select", level: "low" }, ctx);
		await fake.fire("session_info_changed", { type: "session_info_changed", name: "Ship it" }, ctx);
		const call = { toolCallId: "c1", toolName: "bash" };
		await fake.fire(
			"tool_execution_start",
			{ type: "tool_execution_start", ...call, args: {} },
			ctx,
		);
		await fake.fire(
			"tool_execution_update",
			{ type: "tool_execution_update", ...call, args: {}, partialResult: { content: [] } },
			ctx,
		);
		await until(() => types(daemon).includes("pi.tool_execution_update"));
		expect(types(daemon).slice(3)).toEqual([
			"pi.model_select",
			"pi.thinking_level_select",
			"pi.session_info_changed",
			"pi.tool_execution_start",
			"pi.tool_execution_update",
		]);
		expect(daemon.received[3]?.data).toEqual({ type: "model_select", model, source: "set" });
	});

	test("the session's status goes out in pi's words as it changes", async () => {
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("snapshot"));
		await fake.fire("agent_start", { type: "agent_start" }, ctx);
		await fake.fire("agent_settled", { type: "agent_settled", aborted: false }, ctx);
		await until(() => types(daemon).filter((type) => type === "session.state").length === 2);
		expect(
			daemon.received.filter((one) => one.type === "session.state").map((one) => one.data),
		).toEqual([{ state: "working" }, { state: "done" }]);
	});

	test("what the kit logs for this session goes out, and not another session's lines or peers' state", async () => {
		const daemon = await listening();
		const fake = mounted();
		await start(fake);
		await until(() => types(daemon).includes("snapshot"));
		const log = (owner: string, type: string, data: unknown) =>
			fake.pi.events.emit(LOGGED_EVENT, { v: 1, id: "x", at: 1, session: owner, type, data });
		log("other", "mode.changed", { mode: "full" });
		log("s1", "session.state", { state: "running" });
		log("s1", "message.posted", { id: "m1" });
		log("s1", "mode.changed", { mode: "edits" });
		await until(() => types(daemon).includes("mode.changed"));
		await Bun.sleep(20);
		expect(daemon.received.slice(3).map((one) => [one.type, one.data])).toEqual([
			["mode.changed", { mode: "edits" }],
		]);
	});

	test("a snapshot carries the handle, the status, the tasks, the mode and the open questions, as facts too", async () => {
		const daemon = await listening();
		const fake = mounted();
		const scope = { events: fake.pi.events, warn: () => {} };
		const tasks = { ...emptyTasks(), handle: "otter" };
		TASKS.provide(scope, () => ({ state: tasks }));
		MODE.provide(scope, () => "edits");
		await start(fake);
		await until(() => types(daemon).includes("snapshot"));
		const log = (type: string, data: unknown) =>
			fake.pi.events.emit(LOGGED_EVENT, { v: 1, id: "x", at: 1, session: "s1", type, data });
		log("ask.opened", { id: "q1", source: "agent", questions: [] });
		log("ask.opened", { id: "q2", source: "agent", questions: [] });
		log("ask.closed", { id: "q1", result: {} });
		log("call.ruled", { toolCallId: "c1", ruling: { head: "allowed", tone: "success" } });
		daemon.sockets[0]?.write(line(envelope("command", "snapshot.get", {})));
		await until(() => types(daemon).filter((type) => type === "snapshot").length === 2);
		const snapshot = daemon.received.findLast((one) => one.type === "snapshot")?.data as
			| { snapshot: Record<string, unknown>; facts: { type: string; data: unknown }[] }
			| undefined;
		expect(snapshot?.snapshot).toMatchObject({
			handle: "otter",
			state: "idle",
			tasks,
			mode: "edits",
			openAsks: ["q2"],
		});
		expect(snapshot?.facts.map((fact) => fact.type)).toEqual([
			"tasks.changed",
			"mode.changed",
			"ask.opened",
			"call.ruled",
		]);
	});

	test("the remote's files, its socket, its port and its command are protected, whatever the mode", () => {
		const fake = mounted();
		expect(protectedList(fake.pi.events)).toEqual({
			paths: [root],
			sockets: [daemonPaths(root).socket, `127.0.0.1:${CLIENT_PORT}`, `localhost:${CLIENT_PORT}`],
			commands: ["pi-remote"],
		});
	});

	test("a session with no file, as with --no-session, says it is live without one", async () => {
		const daemon = await listening();
		const ctx = session();
		const manager = { ...ctx.sessionManager, getSessionFile: () => undefined };
		await start(mounted(), fakeContext([], true, { ...ctx, sessionManager: manager }));
		await until(() => types(daemon).includes("session.live"));
		const live = daemon.received.find((one) => one.type === "session.live");
		expect(live?.data).not.toHaveProperty("file");
	});

	test("/remote asks the daemon for a token and opens the link with it in the fragment", async () => {
		const daemon = await listening();
		const opened = join(root, "opened");
		const browser = join(root, "browser.sh");
		writeFileSync(browser, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n`);
		chmodSync(browser, 0o755);
		process.env.BROWSER = browser;
		const notes: string[] = [];
		const fake = mounted();
		const ctx = fakeContext(notes, true, {
			cwd: "/work",
			sessionManager: session().sessionManager,
		});
		await start(fake);
		await until(() => types(daemon).includes("snapshot"));
		const asked = fake.commands.get("remote")?.handler("", ctx as never);
		await until(() => daemon.received.some((one) => one.kind === "command"));
		const command = daemon.received.find((one) => one.kind === "command");
		expect(command?.type).toBe("token.issue");
		daemon.sockets[0]?.write(
			line(
				envelope(
					"reply",
					"token.issue",
					{ url: "http://127.0.0.1:9123/#token=abc", expiresAt: 1 },
					{ id: command?.id },
				),
			),
		);
		await asked;
		await until(() => existsSync(opened));
		delete process.env.BROWSER;
		// The link is the daemon's, port and all: pi does not guess where the daemon listens.
		expect(readFileSync(opened, "utf8")).toBe("http://127.0.0.1:9123/#token=abc");
		expect(notes.at(-1)).toContain("works once, for a minute");
	});

	test("/remote with no daemon to ask says there is no link, and opens nothing", async () => {
		const notes: string[] = [];
		// No session started, so no bridge, and nothing tries to start a real daemon from dist/.
		const fake = mounted();
		await fake.commands.get("remote")?.handler("", fakeContext(notes, true) as never);
		expect(notes).toEqual(["pi-remote: the daemon did not answer, so there is no link yet"]);
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

/** A session source that only calls `onFollow` when someone follows it. */
function source(onFollow: (on: (item: SourceItem) => void) => void = () => {}): SessionSource {
	return {
		snapshot: () => Promise.reject(new Error("unused")),
		follow: (_after, on) => {
			onFollow(on);
			return () => {};
		},
	};
}

describe("one bridge", () => {
	function bridged(from: SessionSource = source()) {
		const { sockets, dial } = held();
		const bridge = new Bridge(session(), from, {
			path: "/nowhere",
			scope: { events: fakePi().pi.events, warn: () => {} },
			version: VERSION,
			kind: "terminal",
			api: {
				rename: () => {},
				setModel: () => Promise.resolve(),
				setThinking: () => {},
				setMode: () => {},
				send: () => {},
				arrived: () => {},
			},
			startDaemon: () => {},
			warn: () => {},
			seams: { dial, backoff: [5] },
		});
		bridge.start();
		const [socket] = sockets;
		if (socket === undefined) throw new Error("no socket");
		socket.emit("connect");
		return { bridge, socket };
	}

	const writing = { type: "message_start", message: { role: "assistant", content: [] } };
	const hel = {
		type: "message_update",
		message: { role: "assistant", content: [{ type: "text", text: "Hel" }] },
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" },
	};

	test("a snapshot asked for while deltas wait comes after them, and they never go out again", async () => {
		const { bridge, socket } = bridged();
		bridge.stream.messageStart(writing as unknown as MessageStartEvent);
		bridge.stream.messageUpdate(hel as unknown as MessageUpdateEvent);
		socket.emit("data", line(envelope("command", "snapshot.get", {})));
		await Bun.sleep(50);
		expect(socket.written.map((one) => one.type)).toEqual([
			"bridge",
			"session.live",
			"snapshot",
			"pi.message_start",
			"pi.message_update",
			"snapshot",
		]);
		await bridge.stop(undefined);
	});

	test("a source that lost its place makes the bridge send a new snapshot", async () => {
		const { bridge, socket } = bridged(source((on) => on({ kind: "reset" })));
		expect(socket.written.map((one) => one.type)).toEqual([
			"bridge",
			"session.live",
			"snapshot",
			"snapshot",
		]);
		await bridge.stop(undefined);
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
		// Every event but a delta keeps its place in the epoch, so a replay never has a hole.
		const events = daemon.received.filter((one) => one.kind === "event");
		const deltas = events.filter((one) => one.type === "pi.message_update");
		expect(deltas.length).toBeGreaterThan(0);
		expect(deltas.every((one) => one.seq === undefined)).toBe(true);
		const seqs = events.filter((one) => one.type !== "pi.message_update").map((one) => one.seq);
		expect(seqs).toEqual(seqs.map((_, at) => at));
		expect(daemon.received[1]?.data).toMatchObject({ kind: "background" });
	});
});

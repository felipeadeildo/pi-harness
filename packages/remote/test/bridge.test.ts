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
	MODE_SET,
	protectedList,
	TASKS,
	targetOf,
} from "@adeildo/pi-kit";
import { ANSWER, ASK, CANCEL, totalsOf } from "@adeildo/pi-kit";
import type { SessionSource, SourceItem } from "@adeildo/pi-kit";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { type FakePi, fakeContext, fakePi, keystrokes } from "@adeildo/pi-kit/testing";
import { envelope } from "@adeildo/pi-remote-protocol";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { MessageStartEvent, MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

import { Bridge, REMEMBERED_SENDERS, STATE_ENTRIES, TYPED_EVERY_MS } from "../src/bridge/bridge.ts";
import { Commands } from "../src/bridge/commands.ts";
import { letterOf, SessionInbox } from "../src/bridge/inbox.ts";
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
	/** What a `message` entry carries: pi never writes one without, and `totalsOf` reads its usage. */
	message?: { role?: string; content?: unknown; usage?: unknown };
}

function entries(count: number): Entry[] {
	return Array.from({ length: count }, (_, at) => ({
		type: "message",
		id: `e${at + 1}`,
		parentId: at === 0 ? null : `e${at}`,
		// A `message` entry carries the message pi wrote. A user turn has no usage, so the total is
		// untouched here; the tests that compare a number push a real `usage` entry of their own.
		message: { role: "user", content: [{ type: "text", text: `message ${at + 1}` }] },
	}));
}

/**
 * A session pi titled, with the entries given and the branch through them, in a terminal unless
 * `mode` says otherwise.
 */
/** Whether a run is in flight in the fake session, which is what a follow-up waits for. */
let running = false;

function session(kept: Entry[] = entries(2), mode = "tui", branch: Entry[] = kept) {
	const ctx = fakeContext([], mode === "tui", {
		mode,
		cwd: "/work",
		isIdle: () => !running,
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

/** The state the daemon was last sent, as a client reads it. */
function stateOf(daemon: FakeDaemon): { permissions: { serves?: boolean } } {
	const data = daemon.received.findLast((one) => one.type === "state")?.data as
		| { summary?: { state?: { permissions: { serves?: boolean } } } }
		| undefined;
	return data?.summary?.state ?? { permissions: {} };
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
			type: "state",
			seq: 1,
			data: {
				summary: {
					session: "s1",
					machine: HOST,
					cwd: "/work",
					name: "Fix the release",
					leaf: "e2",
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
		await until(() => types(daemon).includes("state"));
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

	test("a key at the terminal says who is there, once per couple of seconds", async () => {
		const daemon = await listening();
		const fake = mounted();
		await start(fake);
		await until(() => types(daemon).includes("state"));
		// The handler this session registered, which is the last one pi was given.
		const press = keystrokes.at(-1);
		if (press === undefined) throw new Error("no key handler was registered");
		press("a");
		await until(() => daemon.received.some((one) => one.type === "presence.here"));
		const said = daemon.received.find((one) => one.type === "presence.here")?.data as
			| { by: { kind: string; name: string; machine: string } }
			| undefined;
		expect(said?.by.kind).toBe("terminal");
		expect(said?.by.machine).toBe(HOST);
		expect(typeof said?.by.name).toBe("string");
		// A person types faster than the others need to know, so the second key inside the window is
		// not another event.
		press("b");
		await Bun.sleep(20);
		expect(daemon.received.filter((one) => one.type === "presence.here")).toHaveLength(1);
		// Past the window it speaks again, so the mark does not stay with a person who left.
		await Bun.sleep(TYPED_EVERY_MS + 20);
		press("c");
		await until(() => daemon.received.filter((one) => one.type === "presence.here").length === 2);
		await stop(fake, "quit");
	});

	test("a follow-up waits for the agent to settle, and then pi gets it", async () => {
		// A run is in flight, so the letter has something to wait for.
		running = true;
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("state"));
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
		running = false;
	});

	test("a follow-up held through a compaction goes in when the compaction ends, not before", async () => {
		// pi is compacting: it is not idle, no run settles, and a send during it throws.
		running = true;
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("state"));
		daemon.sockets[0]?.write(
			line(
				envelope(
					"command",
					"prompt.send",
					{ text: "typing while it compacts" },
					{
						machine: HOST,
						session: "s1",
						epoch: "e1",
						id: "p3",
						by: { kind: "client", name: "phone", machine: HOST },
					},
				),
			),
		);
		await until(() => daemon.received.some((one) => one.kind === "reply" && one.id === "p3"));
		expect(fake.userMessages).toEqual([]);
		// pi emits the event and only then clears the flag, on the same turn of the loop: a drain inside
		// the handler would still see it compacting, so the queue waits for the next turn.
		setTimeout(() => {
			running = false;
		}, 0);
		await fake.fire("session_compact", { type: "session_compact", aborted: false }, ctx);
		await until(() => fake.userMessages.length === 1);
		expect(fake.userMessages).toEqual(["typing while it compacts"]);
	});

	test("a compaction that ends as the session goes away leaves nothing running behind it", async () => {
		const fake = mounted();
		let stale = false;
		// The context pi refuses once the session it belonged to is gone: the next turn of the loop is
		// exactly when that can happen, and the error lands outside any test, which is how it reached
		// the main with the suite green.
		const ctx = {
			...session(),
			isIdle: () => {
				if (stale) throw new Error("This extension ctx is stale after session replacement");
				return true;
			},
		};
		const uncaught: unknown[] = [];
		const catchIt = (error: unknown): void => {
			uncaught.push(error);
		};
		process.on("uncaughtException", catchIt);
		try {
			await start(fake, ctx);
			await fake.fire("session_compact", { type: "session_compact", aborted: false }, ctx);
			await stop(fake, "quit");
			stale = true;
			// The turn the drain was waiting for, after the shutdown: the timer is already cancelled.
			await Bun.sleep(10);
			expect(uncaught).toEqual([]);
		} finally {
			process.off("uncaughtException", catchIt);
		}
	});

	test("a compaction that failed drains the queue too, as a run that ends would", async () => {
		running = true;
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("state"));
		daemon.sockets[0]?.write(
			line(
				envelope(
					"command",
					"prompt.send",
					{ text: "after the failed compaction" },
					{
						machine: HOST,
						session: "s1",
						epoch: "e1",
						id: "p4",
						by: { kind: "client", name: "phone", machine: HOST },
					},
				),
			),
		);
		await until(() => daemon.received.some((one) => one.kind === "reply" && one.id === "p4"));
		setTimeout(() => {
			running = false;
		}, 0);
		await fake.fire(
			"session_compact_failed",
			{ type: "session_compact_failed", aborted: true },
			ctx,
		);
		await until(() => fake.userMessages.length === 1);
		expect(fake.userMessages).toEqual(["after the failed compaction"]);
	});

	test("a prompt leaves the queue when pi starts the run, and stays until then", async () => {
		// The session is idle, so the letter is sent straight away and waits only for the proof.
		running = false;
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("state"));
		daemon.sockets[0]?.write(
			line(
				envelope(
					"command",
					"prompt.send",
					{ text: "will pi take it" },
					{
						machine: HOST,
						session: "s1",
						epoch: "e1",
						id: "p5",
						by: { kind: "client", name: "phone", machine: HOST },
					},
				),
			),
		);
		await until(() => fake.userMessages.length === 1);
		// The queue reaches the daemon on its own envelope, so the test waits for it rather than for
		// the send: the two are written in that order, and not in the same tick.
		await until(() => daemon.received.some((one) => one.type === "queue.changed"));
		// The send returned and pi has said nothing yet: the letter is still the client's to see.
		const held = daemon.received.findLast((one) => one.type === "queue.changed")?.data as
			| { queue: { text: string }[] }
			| undefined;
		expect(held?.queue.map((one) => one.text)).toEqual(["will pi take it"]);
		// pi's own event is the proof, and it takes the letter out.
		await fake.fire("agent_start", { type: "agent_start" }, ctx);
		await until(
			() =>
				((
					daemon.received.findLast((one) => one.type === "queue.changed")?.data as
						| { queue: unknown[] }
						| undefined
				)?.queue.length ?? 1) === 0,
		);
	});

	test("a prompt into an idle session goes in at once, since nothing can settle", async () => {
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("state"));
		daemon.sockets[0]?.write(
			line(
				envelope(
					"command",
					"prompt.send",
					{ text: "the first one from the phone" },
					{
						machine: HOST,
						session: "s1",
						epoch: "e1",
						id: "p2",
						by: { kind: "client", name: "phone", machine: HOST },
					},
				),
			),
		);
		await until(() => fake.userMessages.length === 1);
		// It never entered the queue a client draws: it went in as the run that was missing.
		expect(fake.userMessages).toEqual(["the first one from the phone"]);
		// The reply is written after the command runs, so it is waited for: asserting it right after
		// the message goes in reads the state before the effect, and fails once in a few runs.
		await until(() => daemon.received.some((one) => one.kind === "reply" && one.id === "p2"));
		await stop(fake, "quit");
	});

	test("a thinking level from a client reaches pi, and one pi does not know is refused", async () => {
		const daemon = await listening();
		const fake = mounted();
		await start(fake);
		await until(() => types(daemon).includes("state"));
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
		await until(() => types(daemon).includes("state"));

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
		await until(() => types(daemon).includes("state"));

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
		await until(() => types(daemon).includes("state"));
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
		await until(() => types(daemon).includes("state"));
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
		await until(() => types(daemon).includes("state"));
		kept.push({
			type: "message",
			id: "e3",
			parentId: "e2",
			message: { role: "user", content: [{ type: "text", text: "the second" }] },
		});
		await fake.fire("turn_end", { type: "turn_end", messageEntryId: "e3" }, ctx);
		await until(() => types(daemon).includes("entry"));
		await fake.fire("turn_end", { type: "turn_end", messageEntryId: "e3" }, ctx);
		await Bun.sleep(20);
		expect(daemon.received.filter((one) => one.type === "entry").map((one) => one.data)).toEqual([
			{
				type: "message",
				id: "e3",
				parentId: "e2",
				message: { role: "user", content: [{ type: "text", text: "the second" }] },
			},
		]);
	});

	test("a snapshot carries the end of the branch, and goes out again when the daemon asks", async () => {
		const daemon = await listening();
		await start(mounted(), session(entries(STATE_ENTRIES + 10)));
		await until(() => types(daemon).includes("state"));
		daemon.sockets[0]?.write(line(envelope("command", "state.get", {})));
		await until(() => types(daemon).filter((type) => type === "state").length === 2);
		const snapshots = daemon.received.filter((one) => one.type === "state");
		for (const one of snapshots) {
			const tail = (one.data as { entries: Entry[] }).entries;
			expect(tail).toHaveLength(STATE_ENTRIES);
			expect(tail.at(-1)?.id).toBe(`e${STATE_ENTRIES + 10}`);
		}
	});

	test("a snapshot carries the queue the state folded, letter and all", async () => {
		// The snapshot builds its queue from the folded state: the fold in `queued` is the only path, so
		// a held letter has to be in it, and removing the fold empties the snapshot.
		running = true;
		const daemon = await listening();
		const fake = mounted();
		await start(fake, session());
		await until(() => types(daemon).includes("state"));
		daemon.sockets[0]?.write(
			line(
				envelope(
					"command",
					"prompt.send",
					{ text: "wait for the run" },
					{
						machine: HOST,
						session: "s1",
						epoch: "e1",
						id: "p9",
						by: { kind: "client", name: "phone", machine: HOST },
					},
				),
			),
		);
		// A busy session holds the letter, so it is in the queue and not in pi: that is the one the
		// snapshot has to carry.
		await until(
			() =>
				((
					daemon.received.findLast((one) => one.type === "queue.changed")?.data as
						| { queue: unknown[] }
						| undefined
				)?.queue.length ?? 0) === 1,
		);
		daemon.sockets[0]?.write(line(envelope("command", "state.get", {}, { session: "s1" })));
		await until(() => daemon.received.filter((one) => one.type === "state").length === 2);
		const snapshot = daemon.received.filter((one) => one.type === "state").at(-1)?.data as
			| { summary: { state: { queue: { text: string }[] } } }
			| undefined;
		expect(snapshot?.summary.state.queue.map((one) => one.text)).toEqual(["wait for the run"]);
	});

	test("a move in the tree names the new leaf, the root included", async () => {
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("state"));
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
		await until(() => types(daemon).includes("state"));
		daemon.sockets[0]?.destroy();
		await until(() => types(daemon).filter((type) => type === "state").length === 2, 3_000);
		kept.push({
			type: "message",
			id: "e3",
			parentId: "e2",
			message: { role: "user", content: [{ type: "text", text: "the first" }] },
		});
		await fake.fire("turn_end", { type: "turn_end", messageEntryId: "e3" }, ctx);
		await until(() => types(daemon).includes("entry"));
		await Bun.sleep(30);
		expect(types(daemon).filter((type) => type === "entry")).toHaveLength(1);
	});

	test("the snapshot carries the branch, not every entry the session holds", async () => {
		const daemon = await listening();
		const all = [...entries(2), { type: "message", id: "x9", parentId: "e1" }];
		await start(mounted(), session(all, "tui", entries(2)));
		await until(() => types(daemon).includes("state"));
		const snapshot = daemon.received.find((one) => one.type === "state")?.data as
			| { entries: Entry[] }
			| undefined;
		expect(snapshot?.entries).toEqual(entries(2));
	});

	test("a change of model, thinking or name, and a running tool's output, each go out", async () => {
		const daemon = await listening();
		const fake = mounted();
		const ctx = session();
		await start(fake, ctx);
		await until(() => types(daemon).includes("state"));
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
		await until(() => types(daemon).includes("state"));
		await fake.fire("agent_start", { type: "agent_start" }, ctx);
		await fake.fire("agent_settled", { type: "agent_settled", aborted: false }, ctx);
		await until(() => types(daemon).filter((type) => type === "session.status").length === 2);
		expect(
			daemon.received.filter((one) => one.type === "session.status").map((one) => one.data),
		).toEqual([{ status: "working" }, { status: "done" }]);
	});

	test("what the kit logs for this session goes out, and not another session's lines or peers' state", async () => {
		const daemon = await listening();
		const fake = mounted();
		await start(fake);
		await until(() => types(daemon).includes("state"));
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

	test("the cost a client draws is the sum the terminal's footer draws, from the same entries", async () => {
		const daemon = await listening();
		const fake = mounted();
		const kept = entries(2);
		await start(fake, session(kept));
		await until(() => types(daemon).includes("state"));
		// pi records the usage of each message, with the money the provider charged. The fake's branch
		// holds the same shape, so the sum the bridge takes is the sum the footer takes.
		kept.push({
			id: "u1",
			parentId: null,
			type: "usage",
			timestamp: "2026-10-25T00:00:00.000Z",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 10,
				cacheWrite: 5,
				totalTokens: 165,
				cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
			},
		} as never);
		await fake.fire("turn_end", { type: "turn_end", messageEntryId: "u1" }, session(kept));
		await until(() => types(daemon).includes("cost.changed"));
		const sent = daemon.received.findLast((one) => one.type === "cost.changed")?.data as
			| { cost: { total: number } }
			| undefined;
		const summed = totalsOf(kept as never);
		// The same branch through the two readers: what the event carried, and what the sum says.
		expect(summed.cost).toBeGreaterThan(0);
		expect(sent?.cost.total).toBe(summed.cost);
	});

	test("a dialog only the terminal can answer reaches the clients, and the others do not", async () => {
		const daemon = await listening();
		const fake = mounted();
		await start(fake, session([]));
		await until(() => types(daemon).includes("state"));
		const prompts = () =>
			daemon.received.filter((one) => one.type === "terminal.prompted").map((one) => one.data);

		await fake.fire(
			"ui_prompt_start",
			{ type: "ui_prompt_start", kind: "select", title: "Pick" },
			session([]),
		);
		await fake.fire("ui_prompt_end", { type: "ui_prompt_end", kind: "select" }, session([]));
		await fake.fire(
			"ui_prompt_start",
			{ type: "ui_prompt_start", kind: "custom", title: "Theme" },
			session([]),
		);
		await fake.fire("ui_prompt_end", { type: "ui_prompt_end", kind: "custom" }, session([]));
		await until(() => prompts().length === 2);

		expect(prompts()).toEqual([
			{ open: true, kind: "custom", title: "Theme" },
			{ open: false, kind: "custom" },
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
		await until(() => types(daemon).includes("state"));
		const log = (type: string, data: unknown) =>
			fake.pi.events.emit(LOGGED_EVENT, { v: 1, id: "x", at: 1, session: "s1", type, data });
		log("ask.opened", { id: "q1", source: "agent", questions: [] });
		log("ask.opened", { id: "q2", source: "agent", questions: [] });
		log("ask.closed", { id: "q1", result: {} });
		log("call.ruled", { toolCallId: "c1", ruling: { head: "allowed", tone: "success" } });
		daemon.sockets[0]?.write(line(envelope("command", "state.get", {})));
		await until(() => types(daemon).filter((type) => type === "state").length === 2);
		const snapshot = daemon.received.findLast((one) => one.type === "state")?.data as
			| { summary: Record<string, unknown> }
			| undefined;
		// The opening keeps what is a photograph, the handle and the status, and nothing the state
		// already carries: `tasks`, the questions and the mode are read from `state` below.
		expect(snapshot?.summary).toMatchObject({ handle: "otter", status: "idle" });
		const state = (snapshot?.summary as { state?: Record<string, unknown> } | undefined)?.state as
			| {
					permissions: { mode?: string; rulings: Record<string, unknown> };
					questions: Record<string, unknown>;
			  }
			| undefined;
		expect(state?.permissions.mode).toBe("edits");
		// The state keeps both, and says which one is still waiting: a reader needs no replay to know.
		expect(state?.questions).toMatchObject({ q1: { id: "q1", closed: true }, q2: { id: "q2" } });
		expect(state?.permissions.rulings).toMatchObject({ c1: { ruling: { head: "allowed" } } });
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
		await until(() => types(daemon).includes("state"));
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
			"state",
			"bridge",
			"session.live",
			"state",
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
		open: () => Promise.reject(new Error("unused")),
		follow: (_after, on) => {
			onFollow(on);
			return () => {};
		},
	};
}

describe("one bridge", () => {
	function bridged(from: SessionSource = source(), typedEveryMs = 2_000) {
		const { sockets, dial } = held();
		const scope = { events: fakePi().pi.events, warn: () => {} };
		const inbox = new SessionInbox(scope, {
			send: () => {},
			busy: () => !running,
			arrived: () => {},
			queued: (queue) => bridge.queued(queue),
		});
		inbox.start();
		// Assigned once the bridge exists: the commands answer through the connection it opened.
		const commands = { run: (_message: unknown): void => {} };
		const bridge = new Bridge(session(), from, {
			typedEveryMs,
			path: "/nowhere",
			scope,
			command: (message) => commands.run(message),
			version: VERSION,
			kind: "terminal",
			api: {
				rename: () => {},
				setModel: () => Promise.resolve(),
				setThinking: () => {},
				setMode: () => {},
				send: () => {},
				arrived: () => {},
				busy: () => false,
			},
			offered: () => [],
			startDaemon: () => {},
			warn: () => {},
			seams: { dial, backoff: [5] },
		});
		bridge.start();
		const built = new Commands({
			session: "s",
			effects: {
				abort: () => {},
				compact: () => {},
				rename: () => {},
				setModel: () => Promise.resolve(),
				setThinking: () => {},
				setMode: () => {},
				prompt: (id, by, text, deliverAs) =>
					inbox.put(letterOf(id, by, text, deliverAs ?? "followUp")),
				clearQueue: (ids) => inbox.take(ids),
				answerAsk: (fields, by) => {
					bridge.answer(typeof fields.ask === "string" ? fields.ask : "", fields.result, by);
				},
				stop: () => {},
			},
			history: bridge.ran(),
			answer: (kind, type, data, id) => bridge.connection.answer(kind, type, data, id),
			received: () => {},
			outcome: () => {},
		});
		commands.run = (message) => built.run(message as never);
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
		socket.emit("data", line(envelope("command", "state.get", {})));
		await Bun.sleep(50);
		expect(socket.written.map((one) => one.type)).toEqual([
			"bridge",
			"session.live",
			"state",
			"pi.message_start",
			"pi.message_update",
			"state",
		]);
		await bridge.stop(undefined);
	});

	test("the window on the terminal opens and closes: a key after it says who is there again", async () => {
		const { bridge, socket } = bridged(source(), 10);
		const press = keystrokes.at(-1);
		if (press === undefined) throw new Error("no key handler was registered");
		const said = () => socket.written.filter((one) => one.type === "presence.here").length;
		press("a");
		press("b");
		expect(said()).toBe(1);
		// It takes no number: a keypress is not an event a client would have to skip in a replay.
		expect(socket.written.find((one) => one.type === "presence.here")?.seq).toBeUndefined();
		await Bun.sleep(15);
		press("c");
		expect(said()).toBe(2);
		// The key itself is still pi's: the handler reads it and hands it on unchanged.
		expect(press("d")).toBeUndefined();
		await bridge.stop(undefined);
	});

	test("the opening says whether the session takes a mode, which is a capability and not a value", async () => {
		const bare = await listening();
		await start(mounted());
		await until(() => types(bare).includes("state"));
		expect(stateOf(bare).permissions.serves).toBe(false);
	});

	test("a session that takes mode.set says so, before any mode was chosen", async () => {
		const serving = await listening();
		const fake = mounted();
		MODE_SET.provide({ events: fake.pi.events, warn: () => {} }, () => ({ set: () => {} }));
		await start(fake);
		await until(() => types(serving).includes("state"));
		expect(stateOf(serving).permissions.serves).toBe(true);
	});

	describe("whose prompt it was", () => {
		const phone = { kind: "client" as const, name: "phone", machine: "box" };
		const tablet = { kind: "client" as const, name: "tablet", machine: "box" };
		const said = (id: string, text: string): SourceItem => ({
			kind: "entry",
			entry: { id, type: "message", message: { role: "user", content: text } } as never,
		});
		const marks = (socket: { written: { type: string; data?: unknown }[] }) =>
			socket.written.filter((one) => one.type === "prompt.from").map((one) => one.data);

		test("each entry is marked with the client whose words it holds, in whatever order they come", async () => {
			// The entries come the other way round from the prompts, as a steer does past a follow-up. A bridge
			// that gave the first entry to the first prompt would mark both wrong.
			let feed: ((item: SourceItem) => void) | undefined;
			const { bridge, socket } = bridged(source((on) => void (feed = on)));
			bridge.sentBy("first, a follow-up", phone);
			bridge.sentBy("second, a steer", tablet);
			feed?.(said("e1", "second, a steer"));
			feed?.(said("e2", "first, a follow-up"));
			expect(marks(socket)).toEqual([
				{ entry: "e1", by: tablet },
				{ entry: "e2", by: phone },
			]);
			await bridge.stop(undefined);
		});

		test("a prompt typed at the terminal is not marked, and does not take a client's mark", async () => {
			let feed: ((item: SourceItem) => void) | undefined;
			const { bridge, socket } = bridged(source((on) => void (feed = on)));
			bridge.sentBy("from the phone", phone);
			feed?.(said("e1", "typed here"));
			expect(marks(socket)).toEqual([]);
			feed?.(said("e2", "from the phone"));
			expect(marks(socket)).toEqual([{ entry: "e2", by: phone }]);
			await bridge.stop(undefined);
		});

		test("two prompts with the same words are not marked, because the words cannot tell them apart", async () => {
			let feed: ((item: SourceItem) => void) | undefined;
			const { bridge, socket } = bridged(source((on) => void (feed = on)));
			bridge.sentBy("ship it", phone);
			bridge.sentBy("ship it", tablet);
			feed?.(said("e1", "ship it"));
			feed?.(said("e2", "ship it"));
			expect(marks(socket)).toEqual([]);
			await bridge.stop(undefined);
		});

		test("the mark is part of the state a snapshot carries, so a client that opens later draws it", async () => {
			let feed: ((item: SourceItem) => void) | undefined;
			const { bridge, socket } = bridged(source((on) => void (feed = on)));
			bridge.sentBy("from the phone", phone);
			feed?.(said("e1", "from the phone"));
			socket.emit("data", line(envelope("command", "state.get", {})));
			await Bun.sleep(50);
			const last = socket.written.findLast((one) => one.type === "state")?.data as
				| { summary: { state: { promptFrom?: Record<string, unknown> } } }
				| undefined;
			expect(last?.summary.state.promptFrom).toEqual({ e1: phone });
			await bridge.stop(undefined);
		});

		test("it remembers a bounded number of prompts, the oldest going first", async () => {
			let feed: ((item: SourceItem) => void) | undefined;
			const { bridge, socket } = bridged(source((on) => void (feed = on)));
			for (let at = 0; at <= REMEMBERED_SENDERS; at++) bridge.sentBy(`prompt ${at}`, phone);
			feed?.(said("e0", "prompt 0"));
			feed?.(said("e1", "prompt 1"));
			expect(marks(socket)).toEqual([{ entry: "e1", by: phone }]);
			await bridge.stop(undefined);
		});
	});

	test("a source that lost its place makes the bridge send a new snapshot", async () => {
		const { bridge, socket } = bridged(source((on) => on({ kind: "reset" })));
		expect(socket.written.map((one) => one.type)).toEqual([
			"bridge",
			"session.live",
			"state",
			"state",
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
		await until(() => types(daemon).includes("state"));
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

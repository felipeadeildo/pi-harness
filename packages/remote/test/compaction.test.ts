// The drain the compaction needs, with a real pi: a client sends a follow-up while pi is writing the
// summary, and the message has to reach pi after the compaction, not sit in the bridge's queue until
// the next run. The two timestamps are pi's own, from its branch: the compaction entry, and the user
// message that carried the follow-up.
//
// What this does not separate: a send that escaped the compaction entirely would reach pi while it is
// idle and still land after the summary, so `t2 > t1` alone cannot tell the queue from a race won. The
// model writing at ten tokens a second covers it in practice; the assertion that proves it waits —
// the letter in the bridge's queue while `compacting` is pending — arrives with the queue in the
// session state.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import type { Client } from "@adeildo/pi-remote-client";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { Daemon } from "../src/daemon/server.ts";
import piRemote from "../src/index.ts";
import { daemonPaths } from "../src/places.ts";
import { VERSION } from "../src/version.ts";
import { clientOf, until } from "./fakes.ts";
import { logIn } from "./login.ts";

// A real pi, a summary streaming in and a round trip over the socket: seconds, not milliseconds.
// The typical pass is 2.5 s; the failure the mutant produces waits out `SLOW`, which is why the
// ceiling is twice `SLOW` rather than the 5 s the suite uses by default.
setDefaultTimeout(30_000);

let root = "";
let rig: Rig | undefined;
let client: Client | undefined;
const daemons: Daemon[] = [];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-remote-compaction-"));
	process.env.PI_REMOTE_DIR = root;
	process.env.PI_REMOTE_SHARE = "1";
});

afterEach(() => {
	client?.stop();
	client = undefined;
	rig?.dispose();
	rig = undefined;
	for (const daemon of daemons.splice(0)) daemon.stop();
	delete process.env.PI_REMOTE_DIR;
	delete process.env.PI_REMOTE_SHARE;
	rmSync(root, { recursive: true, force: true });
});

async function startDaemon(): Promise<{ daemon: Daemon; cookie: string }> {
	const daemon = await Daemon.start({
		socket: daemonPaths(root).socket,
		version: VERSION,
		clientPort: 0,
	});
	if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
	daemons.push(daemon);
	return { daemon, cookie: await logIn(daemon, daemon.clientPort) };
}

/**
 * A real pi whose scripted model writes slowly, so the summary takes long enough for the follow-up
 * to arrive in the middle of it. The first request of a compaction asks for a summary as well, which
 * is why every answer comes from the factory and not from a list of replies.
 */
async function openRig(): Promise<Rig> {
	let turn = 0;
	const opened = await createRig({
		extensions: [piRemote],
		answer: () => fauxAssistantMessage(`Answer ${++turn}, one word at a time.`),
		tokensPerSecond: 10,
	});
	// The bridge would start the daemon `current.json` names when none answers: a test starts its own.
	rmSync(join(root, "current.json"), { force: true });
	return opened;
}

/** How long a real pi, a summary and a round trip may take on a loaded runner: six times the pass. */
const SLOW = 15_000;

interface BranchEntry {
	type: string;
	/** pi writes ISO strings, which sort the way they compare. */
	timestamp?: string;
	message?: { role?: string; content?: unknown };
}

function branch(): BranchEntry[] {
	return rig?.session.sessionManager.getBranch() as unknown as BranchEntry[];
}

/** What a message says, however pi shaped the content. */
function textOf(entry: BranchEntry): string {
	const content = entry.message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (typeof part === "object" && part !== null && "text" in part ? part.text : ""))
		.filter((text): text is string => typeof text === "string")
		.join(" ");
}

test("a follow-up sent while pi compacts reaches pi after the compaction", async () => {
	const { daemon, cookie } = await startDaemon();
	rig = await openRig();
	const session = rig.session.sessionId;
	await until(() => daemon.sessions.get(session)?.snapshot !== undefined, SLOW);

	const opened = clientOf(session, () => daemon.clientPort ?? 0, cookie);
	client = opened.client;
	await client.load();
	await until(() => opened.client.session().snapshot !== undefined, SLOW);

	// Something to compact, and a run that ends before the compaction starts.
	await rig.prompt("the first turn");
	const before = branch().length;

	// The compaction writes a summary at ten tokens a second: long enough for the follow-up below to
	// arrive while pi is inside it, which is the whole point of the test.
	const compacting = rig.session.compact();
	client.send("prompt.send", { text: "after the compaction" });
	// While pi compacts it takes no prompt, so the message waits in the session's queue — the list the
	// clients draw, and the reason a screen can show it and take it back. A send that escaped the
	// compaction would never appear here, and `t2 > t1` alone could not tell the two apart.
	await until(() => opened.client.session().state.queue.length === 1, SLOW);
	expect(opened.client.session().state.queue[0]?.text).toBe("after the compaction");
	await compacting;
	// And the queue is empty once it went in: nothing waits after the compaction.
	await until(() => opened.client.session().state.queue.length === 0, SLOW);

	await until(() => branch().some((entry) => textOf(entry).includes("after the compaction")), SLOW);
	await until(
		() =>
			branch()
				.slice(before)
				.some((entry) => entry.type === "message" && entry.message?.role === "assistant"),
		SLOW,
	);

	const entries = branch().slice(before);
	const compaction = entries.find((entry) => entry.type === "compaction");
	expect(typeof compaction?.timestamp).toBe("string");
	// A compaction replaces the branch with a summary, so the entry carrying the follow-up is the one
	// pi wrote after it, and its time is after the compaction's time.
	const carried = branch().find((entry) => textOf(entry).includes("after the compaction"));
	expect(carried?.type).toBe("message");
	expect(Date.parse(carried?.timestamp ?? "")).toBeGreaterThan(
		Date.parse(compaction?.timestamp ?? ""),
	);
	// It did not merely land in the queue: the model answered it, which only a delivered prompt does.
	const answered = branch()
		.slice(before)
		.some((entry) => entry.message?.role === "assistant" && textOf(entry).includes("Answer"));
	expect(answered).toBe(true);
});

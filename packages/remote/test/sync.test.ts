// A real pi, the daemon and the client: losing the connection or the daemon mid-run still ends with
// every entry once.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import type { Client } from "@adeildo/pi-remote-protocol/client";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { Daemon } from "../src/daemon/server.ts";
import piRemote from "../src/index.ts";
import { daemonPaths } from "../src/places.ts";
import { VERSION } from "../src/version.ts";
import { clientOf, until } from "./fakes.ts";
import { logIn } from "./login.ts";

// A real pi, a reconnect and a restart take seconds, so the file's waits get the room they declare.
setDefaultTimeout(20_000);

let root = "";
let rig: Rig | undefined;
let client: Client | undefined;
const daemons: Daemon[] = [];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-remote-sync-"));
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
	// Every route but the app's own files needs the cookie since C6, and so does the WebSocket.
	return { daemon, cookie: await logIn(daemon, daemon.clientPort) };
}

async function openRig(): Promise<Rig> {
	let turn = 0;
	const opened = await createRig({
		extensions: [piRemote],
		// Long enough that the model writes for about two seconds at 20 tokens a second, so a run
		// cannot finish in milliseconds and a drop has a stream to land in.
		answer: () =>
			fauxAssistantMessage(`${`Answer ${++turn}, written word by word. `.repeat(5)}`.trim()),
		tokensPerSecond: 20,
	});
	// The bridge would start the daemon `current.json` names when none answers: a test starts its own.
	rmSync(join(root, "current.json"), { force: true });
	return opened;
}

/** How long a real pi, a reconnect and a restart may take on a loaded runner. */
const SLOW = 10_000;

/** The ids of pi's branch, which is what the client must end with. */
function branchIds(opened: Rig): string[] {
	return opened.session.sessionManager.getBranch().map((entry) => entry.id);
}

function heldIds(held: Client): string[] {
	return held.session().entries.map((entry) => entry.id);
}

test("a client that loses its connection mid-run ends with the branch, every entry once", async () => {
	const { daemon, cookie } = await startDaemon();
	rig = await openRig();
	const session = rig.session.sessionId;
	await until(() => daemon.sessions.get(session)?.opening !== undefined, SLOW);

	const opened = clientOf(session, () => daemon.clientPort ?? 0, cookie, "pi.message_start");
	client = opened.client;
	await client.load();
	await until(() => opened.client.session().summary !== undefined, SLOW);

	// One turn goes by untouched, so the client holds a cursor in this life of the session. Without
	// one, any reconnect asks for an opening and the test would pass in either world.
	await rig.prompt("first");
	await until(() => opened.client.session().cursor.seq !== undefined, SLOW);

	// Drop before the second turn's first event, so the replay holds numbered events after the cursor.
	opened.arm();
	opened.hold();
	await rig.prompt("second");
	await until(() => opened.dropped(), SLOW);
	await rig.prompt("third");
	opened.release();
	const want = branchIds(rig);
	// The wait asks what the assertion asks: the whole branch, not a list of the same length.
	await until(() => heldIds(opened.client).join(" ") === want.join(" "), SLOW);
	expect(heldIds(opened.client)).toEqual(want);
	expect(opened.dropped()).toBe(true);
	expect(opened.opens()).toBeGreaterThan(1);
	// The model really did write for a while, so the drop had a stream to land in.
	expect(opened.deltas()).toBeGreaterThan(1);
	// The replay filled the gap without a second opening.
	expect(opened.openings()).toBe(1);
});

test("a daemon that restarts mid-run hands the client the branch through a new opening", async () => {
	let { daemon, cookie } = await startDaemon();
	rig = await openRig();
	const session = rig.session.sessionId;
	await until(() => daemon.sessions.get(session)?.opening !== undefined, SLOW);

	const opened = clientOf(session, () => daemon.clientPort ?? 0, cookie);
	client = opened.client;
	await client.load();
	await until(() => opened.client.session().summary !== undefined, SLOW);

	const running = rig.prompt("first");
	daemon.stop();
	({ daemon, cookie } = await startDaemon());
	await running;
	await rig.prompt("second");
	const want = branchIds(rig);
	await until(() => heldIds(opened.client).join(" ") === want.join(" "), SLOW);
	expect(heldIds(opened.client)).toEqual(want);
	expect(opened.opens()).toBeGreaterThan(1);
	// A new daemon has no replay, so the client takes openings; more than a few is a loop.
	expect(opened.openings()).toBeGreaterThan(1);
	expect(opened.openings()).toBeLessThanOrEqual(4);
	// The new daemon learned the session from the bridge, which reconnected on its own.
	expect(daemon.sessions.get(session)?.connected).toBe(true);
});

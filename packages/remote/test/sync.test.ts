// The whole path with a real pi: the bridge in a rig session, the daemon, and the client library over
// a WebSocket. A client that loses its connection, or the daemon, in the middle of a run must end with
// the branch pi wrote: every entry once, none missing.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOST } from "@adeildo/pi-kit";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { connect, memoryCache, type Client, type Transport } from "@adeildo/pi-remote-client";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { Daemon } from "../src/daemon/server.ts";
import piRemote, { daemonSocket } from "../src/index.ts";
import { VERSION } from "../src/version.ts";
import { until } from "./fakes.ts";

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

async function startDaemon(): Promise<Daemon> {
	const daemon = await Daemon.start({
		socket: daemonSocket(root),
		version: VERSION,
		clientPort: 0,
	});
	if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
	daemons.push(daemon);
	return daemon;
}

/**
 * The client library over a real WebSocket to whichever daemon is up, with a handle to drop the
 * connection the way a network does. The client then reconnects on its own, from its cursor.
 */
function clientOf(
	session: string,
	port: () => number,
	dropAt?: string,
): { client: Client; drop(): void; opens(): number; snapshots(): number; dropped(): boolean } {
	let open: WebSocket | undefined;
	let opens = 0;
	let snapshots = 0;
	let dropped = false;
	const transport = (onMessage: (envelope: unknown) => void, onClose: () => void): Transport => {
		const at = port();
		const ws = new WebSocket(`ws://127.0.0.1:${at}/ws`, {
			headers: { Origin: `http://127.0.0.1:${at}` },
		});
		open = ws;
		opens += 1;
		const queued: string[] = [];
		ws.onopen = () => {
			for (const text of queued.splice(0)) ws.send(text);
		};
		ws.onmessage = (event) => {
			const message = JSON.parse(String(event.data)) as { type?: string };
			if (message.type === "snapshot") snapshots += 1;
			onMessage(message);
			// The network goes on the first event of the kind named, so the drop lands inside the run.
			if (message.type === dropAt && !dropped) {
				dropped = true;
				ws.close();
			}
		};
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
	const opened = connect({
		key: { machine: HOST, session },
		cache: memoryCache(),
		open: transport,
		backoff: { first: 20, max: 200 },
	});
	return {
		client: opened,
		drop: () => open?.close(),
		opens: () => opens,
		snapshots: () => snapshots,
		dropped: () => dropped,
	};
}

async function openRig(): Promise<Rig> {
	let turn = 0;
	const opened = await createRig({
		extensions: [piRemote],
		answer: () => fauxAssistantMessage(`Answer ${++turn}, written word by word.`),
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
	const daemon = await startDaemon();
	rig = await openRig();
	const session = rig.session.sessionId;
	await until(() => daemon.sessions.get(session)?.snapshot !== undefined, SLOW);

	// The connection goes as the answer starts streaming, so the client misses part of a run.
	const opened = clientOf(session, () => daemon.clientPort ?? 0, "pi.message_start");
	client = opened.client;
	await client.load();
	await until(() => client?.session().snapshot !== undefined, SLOW);

	await rig.prompt("first");
	await rig.prompt("second");
	const want = branchIds(rig);
	// The wait asks what the assertion asks: the whole branch, not a list of the same length.
	await until(() => heldIds(opened.client).join(" ") === want.join(" "), SLOW);
	expect(heldIds(opened.client)).toEqual(want);
	expect(opened.dropped()).toBe(true);
	expect(opened.opens()).toBeGreaterThan(1);
	// It came back from its cursor: the replay filled the gap, and no second snapshot was needed.
	expect(opened.snapshots()).toBe(1);
});

test("a daemon that restarts mid-run hands the client the branch through a new snapshot", async () => {
	let daemon = await startDaemon();
	rig = await openRig();
	const session = rig.session.sessionId;
	await until(() => daemon.sessions.get(session)?.snapshot !== undefined, SLOW);

	const opened = clientOf(session, () => daemon.clientPort ?? 0);
	client = opened.client;
	await client.load();
	await until(() => client?.session().snapshot !== undefined, SLOW);

	const running = rig.prompt("first");
	daemon.stop();
	daemon = await startDaemon();
	await running;
	await rig.prompt("second");
	const want = branchIds(rig);
	await until(() => heldIds(opened.client).join(" ") === want.join(" "), SLOW);
	expect(heldIds(opened.client)).toEqual(want);
	expect(opened.opens()).toBeGreaterThan(1);
	// A new daemon holds no replay of what came before it, so the client had to take a snapshot: the
	// first one, the bridge's when it reconnected, and the daemon's answer to the client's hello. More
	// than that is a client and a daemon asking each other in a loop.
	expect(opened.snapshots()).toBeGreaterThan(1);
	expect(opened.snapshots()).toBeLessThanOrEqual(3);
	// The new daemon learned the session from the bridge, which reconnected on its own.
	expect(daemon.sessions.get(session)?.connected).toBe(true);
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, HOST } from "@adeildo/pi-kit";
import { type FakePi, fakeContext, fakePi } from "@adeildo/pi-kit/testing";

import { daemonSocket, goneReason, remote } from "../src/index.ts";
import { VERSION } from "../src/version.ts";
import { type FakeDaemon, fakeDaemon, until } from "./fake-daemon.ts";

let root = "";
let daemon: FakeDaemon | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pr-"));
	process.env.PI_REMOTE_DIR = root;
});

afterEach(async () => {
	delete process.env.PI_REMOTE_DIR;
	await daemon?.stop();
	daemon = undefined;
	rmSync(root, { recursive: true, force: true });
});

function mounted(): FakePi {
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(root, "settings.json") })
		.use(remote)
		.build();
	return fake;
}

/** A session titled by the tasks feature, in a terminal unless `tui` says otherwise. */
function session(tui = true) {
	return fakeContext([], tui, {
		cwd: "/work",
		sessionManager: { getSessionId: () => "s1", getSessionName: () => "Fix the release" },
	});
}

async function start(fake: FakePi, tui = true): Promise<void> {
	await fake.fire("session_start", { type: "session_start", reason: "startup" }, session(tui));
}

async function stop(fake: FakePi, reason: string): Promise<void> {
	await fake.fire("session_shutdown", { type: "session_shutdown", reason }, session());
}

describe("the bridge", () => {
	test("a session in a terminal writes the launcher, connects and says it is live", async () => {
		const listening = await fakeDaemon(daemonSocket(root));
		daemon = listening;
		const fake = mounted();
		await start(fake);
		await until(() => listening.received.length === 2);
		expect(JSON.parse(readFileSync(join(root, "current.json"), "utf8")).version).toBe(VERSION);
		const [hello, live] = listening.received;
		expect(hello).toMatchObject({ kind: "hello", machine: HOST, session: "s1" });
		expect(live).toMatchObject({
			type: "session.live",
			seq: 0,
			data: { pid: process.pid, cwd: "/work", name: "Fix the release", kind: "terminal" },
		});
		await stop(fake, "quit");
		await until(() => listening.received.length === 3);
		expect(listening.received[2]).toMatchObject({ type: "session.gone", data: { reason: "exit" } });
	});

	test("pi -p writes nothing and connects to nothing", async () => {
		const listening = await fakeDaemon(daemonSocket(root));
		daemon = listening;
		await start(mounted(), false);
		await Bun.sleep(30);
		expect(listening.sockets).toEqual([]);
		expect(() => statSync(join(root, "current.json"))).toThrow();
	});

	test("each runtime is a new epoch, and a reload ends the old one without saying the session is gone", async () => {
		const listening = await fakeDaemon(daemonSocket(root));
		daemon = listening;
		const before = mounted();
		await start(before);
		await until(() => listening.received.length === 2);
		await stop(before, "reload");
		const after = mounted();
		await start(after);
		await until(() => listening.received.length === 4);
		await stop(after, "new");
		await until(() => listening.received.length === 5);
		expect(listening.received.map((one) => one.type)).toEqual([
			"bridge",
			"session.live",
			"bridge",
			"session.live",
			"session.gone",
		]);
		expect(listening.received[0]?.epoch).not.toBe(listening.received[2]?.epoch);
		expect(listening.received[4]).toMatchObject({
			epoch: listening.received[2]?.epoch,
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

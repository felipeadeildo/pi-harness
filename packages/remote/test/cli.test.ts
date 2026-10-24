import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/cli/run.ts";
import { Daemon } from "../src/daemon/server.ts";
import { until } from "./fakes.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-remote-cli-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** `pi-remote serve` in this test's folder, stopped by the returned function. */
function serve(...flags: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	let stop: () => void = () => {};
	const stopped = new Promise<void>((resolve) => (stop = resolve));
	const code = run(
		["serve", "--port", "0", ...flags],
		(line) => out.push(line),
		(line) => err.push(line),
		{ stopped, env: { PI_REMOTE_DIR: dir }, idleExitMs: 10 },
	);
	return { code: Promise.resolve(code), out, err, stop };
}

test("serve runs the daemon in the foreground until it is stopped, and says where", async () => {
	const served = serve();
	await until(() => served.out.length === 1);
	expect(served.out[0]).toContain(join(dir, "daemon.sock"));
	const port = Number(/127\.0\.0\.1:(\d+)/.exec(served.out[0] ?? "")?.[1]);
	expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toMatchObject({
		uptime: expect.any(Number),
	});

	// Well past the idle wait a daemon a pi started would have, with no session at all.
	await Bun.sleep(60);
	expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);

	const second = serve();
	expect(await second.code).toBe(1);
	expect(second.err[0]).toContain("already answers");

	served.stop();
	expect(await served.code).toBe(0);
});

test("serve refuses a port that is not one", async () => {
	const out: string[] = [];
	const err: string[] = [];
	expect(await run(["serve", "--port", "http"], out.push.bind(out), err.push.bind(err))).toBe(2);
	expect(err[0]).toContain("--port takes a port number");
});

test("a daemon that stays up does not exit for being idle", async () => {
	const exits: string[] = [];
	const daemon = await Daemon.start({
		socket: join(dir, "daemon.sock"),
		version: "1.2.0",
		idleExitMs: 10,
		stayUp: true,
		exited: (reason) => exits.push(reason),
	});
	await Bun.sleep(60);
	expect(exits).toEqual([]);
	daemon?.stop();
	await until(() => exits.length === 1);
});

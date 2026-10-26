import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { portFromSettings, run } from "../src/cli/run.ts";
import { findWebDir } from "../src/daemon/app.ts";
import { Daemon } from "../src/daemon/server.ts";
import { CLIENT_PORT } from "../src/places.ts";
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
		{ stopped, env: { PI_REMOTE_DIR: dir }, idleExitMs: 10, tailnet: async () => undefined },
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

test("serve serves the web app of a built package, as the daemon entry does", async () => {
	// The build's own layout: the export next to the entry, as dist/web is next to dist/cli.js.
	const dist = join(dir, "dist");
	mkdirSync(join(dist, "web"), { recursive: true });
	writeFileSync(join(dist, "web", "index.html"), "<!doctype html><p>the app</p>");
	writeFileSync(join(dist, "web", "files.json"), JSON.stringify(["/index.html"]));
	const out: string[] = [];
	const err: string[] = [];
	let stop: () => void = () => {};
	const stopped = new Promise<void>((resolve) => (stop = resolve));
	const code = run(
		["serve", "--port", "0"],
		(line) => out.push(line),
		(line) => err.push(line),
		{
			stopped,
			env: { PI_REMOTE_DIR: dir },
			webDir: findWebDir(dist),
			tailnet: async () => undefined,
		},
	);
	await until(() => out.length === 1);
	const port = Number(/127\.0\.0\.1:(\d+)/.exec(out[0] ?? "")?.[1]);
	const page = await fetch(`http://127.0.0.1:${port}/`);
	expect(page.status).toBe(200);
	expect(await page.text()).toContain("the app");
	stop();
	expect(await code).toBe(0);
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

test("the port comes from the settings, and a value the decoder refuses falls back to the default", () => {
	// The CLI runs outside pi, so it reads the same file pi writes, in the agent directory.
	const agent = join(dir, "agent");
	const file = join(agent, "extensions", "pi-harness", "settings.json");
	const before = process.env.PI_CODING_AGENT_DIR;
	mkdirSync(join(agent, "extensions", "pi-harness"), { recursive: true });
	try {
		process.env.PI_CODING_AGENT_DIR = agent;
		expect(portFromSettings()).toBe(7878);
		writeFileSync(file, JSON.stringify({ remote: { port: 8123 } }));
		expect(portFromSettings()).toBe(8123);
		// A number the setting does not accept is not a port the daemon may listen on.
		writeFileSync(file, JSON.stringify({ remote: { port: 70_000 } }));
		expect(portFromSettings()).toBe(7878);
	} finally {
		if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = before;
	}
});

test("the export a setting names wins over the one beside the daemon, which is what the gate checks", () => {
	// The gate asks this function before starting anything, so the candidate order it relies on is
	// worth a test: a checkout with `PI_REMOTE_WEB` set must pass with no `dist/web` beside the daemon.
	const beside = join(dir, "dist");
	mkdirSync(join(beside, "web"), { recursive: true });
	writeFileSync(join(beside, "web", "files.json"), JSON.stringify(["/index.html"]));
	const elsewhere = join(dir, "elsewhere");
	mkdirSync(elsewhere, { recursive: true });
	writeFileSync(join(elsewhere, "files.json"), JSON.stringify(["/index.html"]));
	expect(findWebDir(beside, {})).toBe(join(beside, "web"));
	expect(findWebDir(beside, { PI_REMOTE_WEB: elsewhere })).toBe(elsewhere);
	// A folder with no list of its own is not an export, whatever the setting says.
	expect(findWebDir(beside, { PI_REMOTE_WEB: dir })).toBe(join(beside, "web"));
});

test("the setting is nested in the file, and a flat key is not the same thing", () => {
	// The file groups by first segment (`{"remote": {"port": …}}`); the id is dotted. This is the
	// shape the command reads and pi writes, and a flat key silently answers the default.
	const agent = join(dir, "agent2");
	const file = join(agent, "extensions", "pi-harness", "settings.json");
	mkdirSync(join(agent, "extensions", "pi-harness"), { recursive: true });
	const before = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = agent;
		writeFileSync(file, JSON.stringify({ remote: { port: 8123 } }));
		expect(portFromSettings()).toBe(8123);
		writeFileSync(file, JSON.stringify({ "remote.port": 8123 }));
		expect(portFromSettings()).toBe(CLIENT_PORT);
	} finally {
		if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = before;
	}
});

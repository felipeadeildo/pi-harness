// Starting pi from the page: off by default, a folder that exists, tmux and pi on the machine, and
// the answer is the session pi's bridge registers with the ticket.
import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readFolders, startSession } from "@adeildo/pi-remote-protocol/client";

import { Starts, type StartOptions } from "../src/daemon/start.ts";
import { bridgeOf, dir, onSocket, openDaemon, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

/** A tmux that logs its arguments, one per line, and exits with `code`. */
function fakeTmux(code = 0): { tmux: string; args: () => string[] | undefined } {
	const tmux = join(dir, "tmux");
	const log = join(dir, "tmux-args");
	writeFileSync(
		tmux,
		`#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\necho "no server" >&2\nexit ${code}\n`,
		{
			mode: 0o755,
		},
	);
	return {
		tmux,
		args: () => (existsSync(log) ? readFileSync(log, "utf8").trimEnd().split("\n") : undefined),
	};
}

async function daemonWith(options: StartOptions) {
	const { daemon, port, cookie } = await openDaemon(
		new Starts({ allowed: () => true, ...options }),
	);
	const origin = `http://127.0.0.1:${port}`;
	const headers = { cookie, origin, "content-type": "application/json" };
	const here = await machineOf(origin);
	const loggedIn = ((url: string | URL, init?: RequestInit) =>
		fetch(url, { ...init, headers: { ...init?.headers, cookie, origin } })) as typeof fetch;
	return {
		daemon,
		here,
		origin,
		loggedIn,
		start: (folder: unknown) =>
			fetch(`${origin}/machines/${here}/sessions`, {
				method: "POST",
				headers,
				body: JSON.stringify({ folder }),
			}),
	};
}

/** The daemon names itself after the host, which differs between machines. */
async function machineOf(origin: string): Promise<string> {
	const health = (await (await fetch(`${origin}/health`)).json()) as { machine: string };
	return health.machine;
}

async function answer(response: Response): Promise<[number, unknown]> {
	return [response.status, await response.json()];
}

describe("starting pi", () => {
	test("is off unless the operator turned it on, and then lists nothing", async () => {
		const { port, cookie } = await openDaemon();
		const origin = `http://127.0.0.1:${port}`;
		const headers = { cookie, origin };
		const here = await machineOf(origin);
		expect(await answer(await fetch(`${origin}/machines/${here}/folders`, { headers }))).toEqual([
			200,
			{ allowed: false, folders: [] },
		]);
		const [status, body] = await answer(
			await fetch(`${origin}/machines/${here}/sessions`, {
				method: "POST",
				headers,
				body: JSON.stringify({ folder: dir }),
			}),
		);
		expect(status).toBe(403);
		expect(body).toEqual({
			error: `starting sessions from the page is off on ${here}: turn on "remote.startSessions" in pi's settings there`,
		});
	});

	test("runs pi in the folder in the remote's tmux, and answers the session that comes with the ticket", async () => {
		const fake = fakeTmux();
		const folder = join(dir, "work space");
		mkdirSync(folder);
		const { origin, loggedIn, here } = await daemonWith({
			tmux: fake.tmux,
			pi: "/opt/pi's bin/pi",
		});
		const started = startSession(origin, here, folder, loggedIn);
		await until(() => fake.args() !== undefined);
		const args = fake.args() ?? [];
		const ticket = args.find((one) => one.startsWith("PI_REMOTE_TICKET="))?.slice(17) ?? "";
		expect(args).toEqual([
			"-L",
			"pi-remote",
			"set",
			"-gq",
			"extended-keys",
			"on",
			";",
			"set",
			"-gq",
			"extended-keys-format",
			"csi-u",
			";",
			"new-session",
			"-d",
			"-s",
			`work space-${ticket.slice(0, 4)}`,
			"-c",
			folder,
			"-e",
			`PI_REMOTE_TICKET=${ticket}`,
			`exec '/opt/pi'\\''s bin/pi'`,
		]);
		// Another pi registering first is not the one the page started.
		await bridgeOf("other", "e1");
		await bridgeOf("s9", "e1", undefined, undefined, { cwd: folder, ticket });
		expect(await started).toEqual({ machine: here, session: "s9" });
	});

	test("a machine route for a name that is neither this machine nor a known one is a 404", async () => {
		const { port, cookie } = await openDaemon(new Starts({ allowed: () => true }));
		const origin = `http://127.0.0.1:${port}`;
		const asked = await fetch(`${origin}/machines/nowhere/folders`, { headers: { cookie } });
		expect(await answer(asked)).toEqual([404, { error: "no such machine" }]);
	});

	test("takes a folder under ~, and refuses one that is relative, missing or a file", async () => {
		const fake = fakeTmux();
		const { start } = await daemonWith({ tmux: fake.tmux, pi: "pi", waitMs: 10 });
		writeFileSync(join(dir, "notes.md"), "");
		expect(await answer(await start("work"))).toEqual([
			400,
			{ error: "the folder must be an absolute path or start with ~" },
		]);
		expect((await start(join(dir, "nowhere"))).status).toBe(404);
		expect((await start(join(dir, "notes.md"))).status).toBe(400);
		expect((await start({ path: dir })).status).toBe(400);
		// Home exists everywhere; the fake tmux starts nothing, so the wait runs out.
		expect((await start("~")).status).toBe(504);
		const args = fake.args() ?? [];
		expect(args[args.indexOf("-c") + 1]).toBe(process.env.HOME);
	});

	test("says what the machine lacks: tmux, or pi on its PATH", async () => {
		const noTmux = await daemonWith({ tmux: join(dir, "no-tmux"), pi: "pi" });
		expect(await answer(await noTmux.start(dir))).toEqual([
			503,
			{ error: `tmux is not installed on ${noTmux.here}` },
		]);
	});

	test("with no pi on the PATH, says so and starts nothing", async () => {
		const fake = fakeTmux();
		const path = process.env.PATH;
		process.env.PATH = join(dir, "empty");
		try {
			const { start, here } = await daemonWith({ tmux: fake.tmux });
			expect(await answer(await start(dir))).toEqual([
				503,
				{ error: `pi is not on ${here}'s PATH` },
			]);
		} finally {
			process.env.PATH = path;
		}
		expect(fake.args()).toBeUndefined();
	});

	test("a tmux that fails is an error with its words", async () => {
		const failing = await daemonWith({ tmux: fakeTmux(1).tmux, pi: "pi" });
		expect(await answer(await failing.start(dir))).toEqual([
			500,
			{ error: "tmux could not start the session: no server" },
		]);
	});

	test("a pi that never reaches the daemon is a 504 that says where to look", async () => {
		const { start, here } = await daemonWith({ tmux: fakeTmux().tmux, pi: "pi", waitMs: 20 });
		expect(await answer(await start(dir))).toEqual([
			504,
			{
				error: `pi started on ${here} but did not reach the remote in 0.02 s: run pi-remote attach there to see it`,
			},
		]);
	});
});

describe("a start from this machine's own pi", () => {
	test("needs no setting, and gives pi its first message", async () => {
		const fake = fakeTmux();
		const folder = join(dir, "work");
		mkdirSync(folder);
		const { here } = await daemonWith({ tmux: fake.tmux, pi: "pi", allowed: () => false });
		const answered = onSocket("session.start", { folder, prompt: "read the 'README'" });
		await until(() => fake.args() !== undefined);
		const args = fake.args() ?? [];
		expect(args.at(-1)).toBe(`exec 'pi' -- 'read the '\\''README'\\'''`);
		const ticket = args.find((one) => one.startsWith("PI_REMOTE_TICKET="))?.slice(17) ?? "";
		await bridgeOf("s3", "e1", undefined, undefined, { cwd: folder, ticket });
		const answer = await answered;
		expect([answer.kind, answer.data]).toEqual(["reply", { machine: here, session: "s3" }]);
	});

	test("says why it did not start: a long first message, a missing folder, an unknown machine", async () => {
		await daemonWith({ tmux: fakeTmux().tmux, pi: "pi" });
		const long = await onSocket("session.start", { folder: dir, prompt: "x".repeat(4_001) });
		expect([long.kind, long.data]).toEqual([
			"error",
			{ reason: "a first message has at most 4000 characters" },
		]);
		const missing = await onSocket("session.start", { folder: join(dir, "nowhere") });
		expect(missing.data).toEqual({ reason: `there is no folder at ${join(dir, "nowhere")}` });
		const elsewhere = await onSocket("session.start", { folder: dir, machine: "desk" });
		expect(elsewhere.data).toEqual({ reason: "no machine named desk answers" });
		const shapeless = await onSocket("session.start", { path: dir });
		expect(shapeless.data).toEqual({ reason: "a start carries { folder, prompt? }" });
	});
});

describe("the recent folders", () => {
	/** One folder of pi's sessions, whose newest file names `cwd` and was written at `at`. */
	function sessionsOf(root: string, name: string, cwd: string, at: number): void {
		const folder = join(root, name);
		mkdirSync(folder, { recursive: true });
		writeFileSync(
			join(folder, "2026-01-01T00-00-00-000Z_old.jsonl"),
			`${JSON.stringify({ cwd: "/old" })}\n`,
		);
		const newest = join(folder, "2026-02-01T00-00-00-000Z_new.jsonl");
		writeFileSync(newest, `${JSON.stringify({ type: "session", cwd })}\n{"type":"message"}\n`);
		utimesSync(newest, at / 1000, at / 1000);
	}

	test("are the folders pi worked in, newest first, and only the ones still there", async () => {
		const root = join(dir, "sessions");
		const a = join(dir, "a");
		const b = join(dir, "b");
		mkdirSync(a);
		mkdirSync(b);
		sessionsOf(root, "--a--", a, 1_000_000);
		sessionsOf(root, "--b--", b, 2_000_000);
		sessionsOf(root, "--gone--", join(dir, "gone"), 3_000_000);
		mkdirSync(join(root, "--empty--"));
		const { origin, here, loggedIn } = await daemonWith({ sessionsDir: root });
		expect(await readFolders(origin, here, loggedIn)).toEqual({
			allowed: true,
			folders: [
				{ path: b, at: 2_000_000 },
				{ path: a, at: 1_000_000 },
			],
		});
	});
});

const hasTmux = (() => {
	try {
		execFileSync("tmux", ["-V"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

// CI installs tmux, so this runs there; it proves the arguments on a real tmux.
test.skipIf(!hasTmux)(
	"a real tmux runs the command in the folder, with the ticket in its environment and extended keys on",
	async () => {
		const folder = join(dir, "real folder");
		mkdirSync(folder);
		const said = join(dir, "said");
		const pi = join(dir, "pi");
		// It stays a moment, so the server is still there to ask for its options.
		writeFileSync(pi, `#!/bin/sh\necho "$PWD $PI_REMOTE_TICKET" > "${said}"\nsleep 5\n`, {
			mode: 0o755,
		});
		const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: dir };
		delete env.TMUX;
		const previous = { TMUX_TMPDIR: process.env.TMUX_TMPDIR, TMUX: process.env.TMUX };
		process.env.TMUX_TMPDIR = dir;
		delete process.env.TMUX;
		try {
			const { start } = await daemonWith({ pi, waitMs: 300 });
			const response = await start(folder);
			expect(response.status).toBe(504);
			await until(() => existsSync(said));
			const [cwd, ticket] = readFileSync(said, "utf8")
				.trim()
				.split(/ (?=[^ ]+$)/);
			expect(cwd).toBe(folder);
			expect(ticket).toMatch(/^[0-9a-f-]{36}$/);
			const option = (name: string) =>
				spawnSync("tmux", ["-L", "pi-remote", "show", "-gv", name], {
					env,
					encoding: "utf8",
				}).stdout.trim();
			expect(option("extended-keys")).toBe("on");
		} finally {
			spawnSync("tmux", ["-L", "pi-remote", "kill-server"], { env, stdio: "ignore" });
			if (previous.TMUX_TMPDIR === undefined) delete process.env.TMUX_TMPDIR;
			else process.env.TMUX_TMPDIR = previous.TMUX_TMPDIR;
			if (previous.TMUX !== undefined) process.env.TMUX = previous.TMUX;
		}
	},
);

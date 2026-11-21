// The desk: a window of the operator's terminal on a session of the remote's tmux, letting the
// windows go, ending a session, and moving a pi out of tmux into a window or this terminal.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "../src/cli/run.ts";
import { Desk, filled, type Resumable } from "../src/daemon/desk.ts";
import { Terminals } from "../src/daemon/terminal.ts";
import { bridgeOf, dir, openDaemon, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

/** What the desk would have opened: the program and its arguments, and the folder. */
function launches() {
	const opened: { argv: readonly string[]; cwd: string }[] = [];
	const launch = (argv: readonly string[], cwd: string) => {
		opened.push({ argv, cwd });
		return Promise.resolve();
	};
	return { opened, launch };
}

const DESKTOP = { WAYLAND_DISPLAY: "wayland-1", PATH: "" };

describe("the window's command", () => {
	test("a template puts the program at {cmd} and the folder at {cwd}", () => {
		expect(filled("kitty --directory {cwd} {cmd}", ["pi", "--session", "/s"], "/w")).toEqual([
			"kitty",
			"--directory",
			"/w",
			"pi",
			"--session",
			"/s",
		]);
	});

	test("a template with no {cmd} gets the program at its end", () => {
		expect(filled("ghostty -e", ["htop"], "/w")).toEqual(["ghostty", "-e", "htop"]);
	});

	test("with no template it is $TERMINAL -e, and the program runs in its folder", async () => {
		const { opened, launch } = launches();
		const desk = new Desk({ env: { ...DESKTOP, TERMINAL: "ghostty" }, template: () => "", launch });
		await desk.open(["pi", "--session", "/s/it's.jsonl"], "/w/a b", "laptop");
		expect(opened).toEqual([
			{
				argv: [
					"ghostty",
					"-e",
					"sh",
					"-c",
					"cd '/w/a b' && exec 'pi' '--session' '/s/it'\\''s.jsonl'",
				],
				cwd: "/w/a b",
			},
		]);
	});

	test("a Linux machine with no desktop says how to reach the session instead", async () => {
		const desk = new Desk({ env: { TERMINAL: "ghostty" }, platform: "linux", template: () => "" });
		expect(desk.open(["htop"], "/", "server")).rejects.toThrow(
			"server has no desktop the remote can open a window on: run pi-remote attach in a terminal there",
		);
	});

	test("no terminal at all names the setting", async () => {
		const desk = new Desk({ env: DESKTOP, template: () => undefined });
		expect(desk.open(["htop"], "/", "laptop")).rejects.toThrow(
			'no terminal to open on laptop: set $TERMINAL there, or "Terminal for windows" under Remote in /harness',
		);
	});
});

/** A session whose program is `sleep`, standing in for pi: `exec` keeps the pane's pid. */
async function session(name: string): Promise<{ folder: string; pid: number }> {
	const folder = join(dir, name);
	mkdirSync(folder, { recursive: true });
	execFileSync("tmux", [
		"-L",
		"pi-remote",
		"new-session",
		"-d",
		"-s",
		name,
		"-c",
		folder,
		"exec sleep 600",
	]);
	const shown = (format: string) =>
		execFileSync("tmux", ["-L", "pi-remote", "display", "-p", "-t", `=${name}:`, format], {
			encoding: "utf8",
		}).trim();
	// The shell that runs the command becomes `sleep` a moment later.
	await until(() => shown("#{pane_current_command}") === "sleep");
	return { folder, pid: Number(shown("#{pane_pid}")) };
}

/** A session file pi already wrote. */
function written(name: string): string {
	const file = join(dir, name);
	writeFileSync(file, "{}\n");
	return file;
}

/** `until` for a condition that has to ask tmux. */
async function eventually(holds: () => Promise<boolean>): Promise<void> {
	for (const end = Date.now() + 2_000; !(await holds()); await Bun.sleep(20))
		if (Date.now() > end) throw new Error("the condition never held");
}

function has(name: string): boolean {
	return spawnSync("tmux", ["-L", "pi-remote", "has-session", "-t", `=${name}`]).status === 0;
}

const hasTmux = spawnSync("tmux", ["-V"]).status === 0;

// CI installs tmux, so these run there.
describe.skipIf(!hasTmux)("sessions of a real tmux", () => {
	let previous: { TMUX_TMPDIR: string | undefined; TMUX: string | undefined };

	beforeEach(() => {
		previous = { TMUX_TMPDIR: process.env.TMUX_TMPDIR, TMUX: process.env.TMUX };
		process.env.TMUX_TMPDIR = dir;
		delete process.env.TMUX;
	});

	afterEach(() => {
		spawnSync("tmux", ["-L", "pi-remote", "kill-server"], { stdio: "ignore" });
		if (previous.TMUX_TMPDIR === undefined) delete process.env.TMUX_TMPDIR;
		else process.env.TMUX_TMPDIR = previous.TMUX_TMPDIR;
		if (previous.TMUX !== undefined) process.env.TMUX = previous.TMUX;
	});

	test("lists each session once, with its program's pid and no window yet", async () => {
		const { folder, pid } = await session("work");
		execFileSync("tmux", ["-L", "pi-remote", "split-window", "-t", "=work:", "exec sleep 600"]);
		expect(await new Desk().sessions("laptop")).toMatchObject([
			{ name: "work", command: "sleep", folder, pid, windows: 0 },
		]);
	});

	test("a window attaches to the session, in its folder", async () => {
		const { folder } = await session("work");
		const { opened, launch } = launches();
		await new Desk({ env: { ...DESKTOP, TERMINAL: "ghostty" }, template: () => "", launch }).window(
			"work",
			"laptop",
		);
		expect(opened[0]?.argv.at(-1)).toBe(
			`cd '${folder}' && exec 'tmux' '-L' 'pi-remote' 'attach-session' '-t' '=work'`,
		);
	});

	test("detach lets a window go and leaves a page's view, and the session runs on", async () => {
		await session("work");
		// A page's view is a control client; `script` gives a plain client the terminal it needs.
		const page = spawn("tmux", ["-L", "pi-remote", "-C", "attach-session", "-t", "=work"], {
			stdio: "pipe",
		});
		const window = spawn(
			"script",
			["-qfc", "tmux -L pi-remote attach-session -t =work", "/dev/null"],
			// CI gives no TERM, and tmux refuses a terminal it cannot name.
			{ stdio: "pipe", env: { ...process.env, TERM: "xterm-256color" } },
		);
		const desk = new Desk();
		await eventually(async () => (await desk.sessions("laptop"))[0]?.windows === 1);
		expect(await desk.detach("work", "laptop")).toBe(1);
		expect((await desk.sessions("laptop"))[0]?.windows).toBe(0);
		const clients = execFileSync(
			"tmux",
			["-L", "pi-remote", "list-clients", "-F", "#{client_control_mode}"],
			{
				encoding: "utf8",
			},
		);
		expect(clients.trim()).toBe("1");
		expect(has("work")).toBe(true);
		page.kill();
		window.kill();
	});

	test("stop ends the session, and a name tmux does not have is a 404", async () => {
		await session("work");
		const desk = new Desk();
		await desk.stop("work", "laptop");
		expect(has("work")).toBe(false);
		expect(desk.stop("work", "laptop")).rejects.toMatchObject({ status: 404 });
	});

	test("release ends an idle pi and answers what resumes it", async () => {
		const { folder, pid } = await session("work");
		const file = written("one.jsonl");
		const asked: number[] = [];
		const find = (at: number): Promise<Resumable> => {
			asked.push(at);
			return Promise.resolve({ cwd: folder, file, status: "idle" });
		};
		expect(await new Desk().release("work", "laptop", find)).toEqual({
			args: ["--session", file],
			cwd: folder,
		});
		expect(asked).toEqual([pid]);
		expect(has("work")).toBe(false);
		expect(() => process.kill(pid, 0)).toThrow();
	});

	test("a pi that has not answered yet has no file, and starts fresh", async () => {
		const { folder } = await session("work");
		const find = () =>
			Promise.resolve({ cwd: folder, file: join(dir, "none.jsonl"), status: "idle" });
		expect(await new Desk().release("work", "laptop", find)).toEqual({ args: [], cwd: folder });
	});

	test("release leaves a working agent, a pi with no file and a program that is not pi alone", async () => {
		const { folder } = await session("work");
		const desk = new Desk();
		const as = (pi: Resumable | undefined) => () => Promise.resolve(pi);
		expect(
			desk.release("work", "laptop", as({ cwd: folder, file: "/s", status: "working" })),
		).rejects.toThrow("the agent in work is working: interrupt it first");
		expect(desk.release("work", "laptop", as({ cwd: folder }))).rejects.toThrow(
			"the pi in work keeps no session file, so nothing resumes it",
		);
		expect(desk.release("work", "laptop", as(undefined))).rejects.toThrow(
			"work runs sleep, not a pi the remote knows",
		);
		expect(has("work")).toBe(true);
	});

	test("the page moves a pi into a window: pi resumes its session there, outside tmux", async () => {
		const { folder, pid } = await session("work");
		const { opened, launch } = launches();
		const desk = new Desk({ env: { ...DESKTOP, TERMINAL: "ghostty" }, template: () => "", launch });
		const { port, cookie } = await openDaemon({
			terminals: new Terminals({ allowed: () => true, desk, pi: "/bin/pi" }),
		});
		const origin = `http://127.0.0.1:${port}`;
		const here = ((await (await fetch(`${origin}/health`)).json()) as { machine: string }).machine;
		const headers = { cookie, origin };
		const file = written("one.jsonl");
		const bridge = await bridgeOf("s1", "e1", file, undefined, { cwd: folder, pid });
		bridge.state([]);
		const list = async () =>
			(
				(await (await fetch(`${origin}/machines/${here}/terminals`, { headers })).json()) as {
					terminals: { name: string; session?: string }[];
				}
			).terminals;
		await eventually(async () => (await list())[0]?.session === "s1");
		const moved = await fetch(`${origin}/machines/${here}/terminals/work/move`, {
			method: "POST",
			headers,
		});
		expect([moved.status, await moved.json()]).toEqual([200, { machine: here, name: "work" }]);
		expect(opened).toEqual([
			{
				argv: [
					"ghostty",
					"-e",
					"sh",
					"-c",
					`cd '${folder}' && exec '/bin/pi' '--session' '${file}'`,
				],
				cwd: folder,
			},
		]);
		expect(has("work")).toBe(false);
		bridge.close();
	});

	test("pi-remote move ends the pi and resumes its session in this terminal", async () => {
		const { folder, pid } = await session("work");
		const { daemon } = await openDaemon();
		const file = written("one.jsonl");
		const bridge = await bridgeOf("s1", "e1", file, undefined, { cwd: folder, pid });
		bridge.state([]);
		await until(() => daemon.sessions.resumable(pid) !== undefined);
		const resumed: [readonly string[], string][] = [];
		const out: string[] = [];
		const err: string[] = [];
		const code = await run(
			["move", "work"],
			(line) => out.push(line),
			(line) => err.push(line),
			{
				env: { ...process.env, PI_REMOTE_DIR: join(dir, "remote") },
				resume: (args, cwd) => {
					resumed.push([args, cwd]);
					return Promise.resolve(0);
				},
			},
		);
		expect([code, err]).toEqual([0, []]);
		expect(resumed).toEqual([[["--session", file], folder]]);
		expect(out).toEqual([`Resuming work here: pi --session ${file}`]);
		expect(has("work")).toBe(false);
		bridge.close();
	});
});

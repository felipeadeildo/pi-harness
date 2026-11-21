// The machine's own screen: a window of the operator's terminal that opens a session of the remote's
// tmux, and the tmux verbs the page and `pi-remote` share. Only Node's modules, so the command
// imports it too.
import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { shellQuoted } from "../launcher.ts";
import { DESK_ID, globalSetting, TMUX_SOCKET } from "../places.ts";
import { Refused } from "./refused.ts";
import { run } from "./tmux.ts";

/** Letters, digits, `_` and `-` only: a name goes into tmux commands. */
export const NAME = /^[\w-]{1,80}$/;

export interface DeskOptions {
	tmux?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	/** The template the operator set, read from the global settings by default. */
	template?: () => unknown;
	/** Starts the window's program; a test passes a fake. */
	launch?: (argv: readonly string[], cwd: string) => Promise<void>;
}

/** One session of the remote's tmux, as the desk sees it. */
export interface DeskSession {
	name: string;
	/** What runs in it now, as `fish` or `pi`. */
	command: string;
	folder: string;
	/** In ms. */
	created: number;
	/** The program the session started with: pi's own pid, since the daemon starts it with `exec`. */
	pid: number;
	/** Terminals showing it now; a page's view does not count. */
	windows: number;
}

/** What the page and the command may do to a session of the remote's tmux. */
export const TERMINAL_ACTIONS = ["window", "detach", "stop", "move"] as const;
export type TerminalAction = (typeof TERMINAL_ACTIONS)[number];

/** A pi the daemon knows, by the pid its bridge reported. */
export interface Resumable {
	cwd: string;
	/** Absent under `pi --no-session`. */
	file?: string;
	status?: string;
}

/** How long a pi has to exit once its session ends. */
const EXIT_MS = 5_000;

/** Folder last, so a tab in its name stays in it. */
const FIELDS =
	"#{session_name}\t#{pane_current_command}\t#{session_created}\t#{pane_pid}\t#{pane_current_path}";

export class Desk {
	readonly #options: DeskOptions;

	constructor(options: DeskOptions = {}) {
		this.#options = options;
	}

	/** None when the remote's tmux is not running. */
	async sessions(machine: string): Promise<DeskSession[]> {
		const ran = await this.#tmux(["list-panes", "-a", "-F", FIELDS]);
		if (ran.code === undefined) throw new Refused(503, `tmux is not installed on ${machine}`);
		if (ran.code !== 0) return [];
		const windows = await this.#windows();
		const seen = new Set<string>();
		const found: DeskSession[] = [];
		for (const line of ran.out.split("\n").filter(Boolean)) {
			const [name = "", command = "", created = "0", pid = "0", ...folder] = line.split("\t");
			// A session with several panes is listed once, by its first.
			if (seen.has(name)) continue;
			seen.add(name);
			found.push({
				name,
				command,
				folder: folder.join("\t"),
				created: Number(created) * 1000,
				pid: Number(pid),
				windows: windows.get(name) ?? 0,
			});
		}
		return found;
	}

	async #session(name: string, machine: string): Promise<DeskSession> {
		const found = NAME.test(name)
			? (await this.sessions(machine)).find((one) => one.name === name)
			: undefined;
		if (found === undefined) throw new Refused(404, `no terminal named ${name} on ${machine}`);
		return found;
	}

	/** A window of the operator's terminal on this machine's screen, showing the session. */
	async window(name: string, machine: string): Promise<void> {
		const { folder } = await this.#session(name, machine);
		await this.open(
			[this.#options.tmux ?? "tmux", "-L", TMUX_SOCKET, "attach-session", "-t", `=${name}`],
			folder,
			machine,
		);
	}

	/** The terminals that show the session let go of it; it goes on running. */
	async detach(name: string, machine: string): Promise<number> {
		await this.#session(name, machine);
		const clients = await this.#tmux([
			"list-clients",
			"-t",
			`=${name}`,
			"-F",
			"#{client_name}\t#{client_control_mode}",
		]);
		const windows = clients.out
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split("\t"))
			.filter(([, control]) => control !== "1")
			.map(([client = ""]) => client);
		// A page's view is a control client: it stays, since the page closes it itself.
		await Promise.all(windows.map((client) => this.#tmux(["detach-client", "-t", client])));
		return windows.length;
	}

	/** Ends the session and what runs in it. */
	async stop(name: string, machine: string): Promise<void> {
		await this.#session(name, machine);
		const ran = await this.#tmux(["kill-session", "-t", `=${name}`]);
		if (ran.code !== 0) throw new Error(`tmux could not end ${name}: ${ran.err.trim()}`);
	}

	/**
	 * Ends the pi in the session once its agent is idle, and answers how to resume it: pi's arguments
	 * and its folder. `find` names the pi a pid belongs to.
	 */
	async release(
		name: string,
		machine: string,
		find: (pid: number) => Promise<Resumable | undefined>,
	): Promise<{ args: string[]; cwd: string }> {
		const { pid, command } = await this.#session(name, machine);
		const pi = await find(pid);
		if (pi === undefined)
			throw new Refused(409, `${name} runs ${command}, not a pi the remote knows`);
		if (pi.file === undefined)
			throw new Refused(409, `the pi in ${name} keeps no session file, so nothing resumes it`);
		if (pi.status === "working" || pi.status === "blocked")
			throw new Refused(409, `the agent in ${name} is working: interrupt it first`);
		await this.stop(name, machine);
		if (!(await exited(pid))) throw new Error(`the pi in ${name} did not exit`);
		// Pi writes the file with the first answer, so a pi that has none starts fresh.
		return { args: existsSync(pi.file) ? ["--session", pi.file] : [], cwd: pi.cwd };
	}

	/** Runs `argv` in `cwd`, in a new window of the operator's terminal. */
	async open(argv: readonly string[], cwd: string, machine: string): Promise<void> {
		const launch = this.#options.launch ?? launched;
		await launch(await this.#terminal(argv, cwd, machine), cwd);
	}

	/**
	 * What opens the window: the template the operator set, else `$TERMINAL -e`, else the
	 * freedesktop launcher, else Debian's.
	 */
	async #terminal(argv: readonly string[], cwd: string, machine: string): Promise<string[]> {
		const env = this.#options.env ?? process.env;
		const platform = this.#options.platform ?? process.platform;
		if (platform === "linux" && !env.WAYLAND_DISPLAY && !env.DISPLAY)
			throw new Refused(
				409,
				`${machine} has no desktop the remote can open a window on: run pi-remote attach in a terminal there`,
			);
		// The program runs in the folder even under a terminal that starts in its own.
		const inFolder = [
			"sh",
			"-c",
			`cd ${shellQuoted(cwd)} && exec ${argv.map(shellQuoted).join(" ")}`,
		];
		const template = (this.#options.template ?? (() => globalSetting(DESK_ID, env)))();
		if (typeof template === "string" && template.trim() !== "")
			return filled(template, inFolder, cwd);
		if (env.TERMINAL) return [env.TERMINAL, "-e", ...inFolder];
		for (const [program, ...flags] of [
			["xdg-terminal-exec"],
			["x-terminal-emulator", "-e"],
		] as const)
			if (await onPath(program, env)) return [program, ...flags, ...inFolder];
		throw new Refused(
			409,
			`no terminal to open on ${machine}: set $TERMINAL there, or "Terminal for windows" under Remote in /harness`,
		);
	}

	async #windows(): Promise<Map<string, number>> {
		const ran = await this.#tmux(["list-clients", "-F", "#{session_name}\t#{client_control_mode}"]);
		const count = new Map<string, number>();
		for (const line of ran.out.split("\n").filter(Boolean)) {
			const [name = "", control] = line.split("\t");
			if (control !== "1") count.set(name, (count.get(name) ?? 0) + 1);
		}
		return count;
	}

	#tmux(args: readonly string[]) {
		return run(this.#options.tmux ?? "tmux", ["-L", TMUX_SOCKET, ...args]);
	}
}

/**
 * `{cmd}` stands for the program and its arguments, `{cwd}` for the folder; a template without
 * `{cmd}` gets the program at its end. Split on spaces, so a path with one goes in `{cwd}`.
 */
export function filled(template: string, argv: readonly string[], cwd: string): string[] {
	const words = template.trim().split(/\s+/);
	const out = words.flatMap((word) =>
		word === "{cmd}" ? [...argv] : [word.replaceAll("{cwd}", cwd)],
	);
	return words.includes("{cmd}") ? out : [...out, ...argv];
}

async function exited(pid: number): Promise<boolean> {
	for (let waited = 0; waited < EXIT_MS; waited += 50) {
		if (!alive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return !alive(pid);
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Detached, so the window outlives the daemon; it fails only when the program does not start. */
function launched(argv: readonly string[], cwd: string): Promise<void> {
	const [program = "", ...args] = argv;
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, { cwd, detached: true, stdio: "ignore" });
		child.once("error", () => reject(new Refused(503, `${program} could not start`)));
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

export async function onPath(
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
	for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const path = join(dir, name);
		if (
			await access(path, constants.X_OK).then(
				() => true,
				() => false,
			)
		)
			return path;
	}
	return undefined;
}

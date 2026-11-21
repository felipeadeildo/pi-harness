import { spawn, type StdioOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findWebDir } from "../daemon/app.ts";
import { Desk } from "../daemon/desk.ts";
import { Daemon } from "../daemon/server.ts";
import { readTailnet, type Tailnet } from "../daemon/tailnet.ts";
import {
	CLIENT_PORT,
	daemonDir,
	daemonPaths,
	globalSetting,
	PORT_ID,
	portOf,
	TMUX_SOCKET,
} from "../places.ts";
import { VERSION } from "../version.ts";
import { open } from "./open.ts";
import { act, type DeskVerbs, list, move } from "./sessions.ts";

const USAGE =
	"usage: pi-remote --version | open | ls | attach [name] | window|detach|stop|move <name> | serve [--dev] [--port <n>]";

export function run(
	args: readonly string[],
	out: (line: string) => void,
	err: (line: string) => void,
	options: RunOptions = {},
): number | Promise<number> {
	const [first, ...rest] = args;
	if (first === "--version" || first === "-v") {
		out(VERSION);
		return 0;
	}
	if (first === "serve") return serve(rest, out, err, options);
	if (first === "open") return open(daemonPaths(daemonDir()).socket, out, err);
	if (first === "attach") {
		if (rest.length > 1) {
			err(`pi-remote: attach takes at most a session's name\n${USAGE}`);
			return 2;
		}
		return attach(options.tmux ?? "tmux", rest[0], err);
	}
	if (
		first === "ls" ||
		first === "window" ||
		first === "detach" ||
		first === "stop" ||
		first === "move"
	)
		return desk(first, rest, out, err, options);
	err(first === undefined ? USAGE : `pi-remote: unknown command "${first}"\n${USAGE}`);
	return 2;
}

export interface RunOptions {
	/** The tmux program; a test passes a fake. */
	tmux?: string;
	/** Injected so a test can stop it. */
	stopped?: Promise<void>;
	env?: NodeJS.ProcessEnv;
	webDir?: string;
	/** So a test sees `serve` outlast a pi-started daemon. */
	idleExitMs?: number;
	tailnet?: () => Promise<Tailnet | undefined>;
	/** What opens a window, and what resumes pi here; a test passes fakes. */
	launch?: (argv: readonly string[], cwd: string) => Promise<void>;
	resume?: (args: readonly string[], cwd: string) => Promise<number>;
}

/** Runs the daemon in the foreground, never idling out. `--dev` runs `src/` under `bun --watch`. */
async function serve(
	flags: readonly string[],
	out: (line: string) => void,
	err: (line: string) => void,
	options: RunOptions,
): Promise<number> {
	// `--port` by hand wins over the setting.
	const at = flags.indexOf("--port");
	const port = at === -1 ? portFromSettings() : Number(flags[at + 1]);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		err(`pi-remote: --port takes a port number\n${USAGE}`);
		return 2;
	}
	if (flags.includes("--dev")) return dev(port, err);
	const paths = daemonPaths(daemonDir(options.env));
	let exited: () => void = () => {};
	const done = new Promise<void>((resolve) => (exited = resolve));
	const daemon = await Daemon.start({
		...paths,
		version: VERSION,
		clientPort: port,
		stayUp: true,
		webDir: options.webDir ?? findWebDir(dirname(fileURLToPath(import.meta.url)), options.env),
		...(options.idleExitMs === undefined ? {} : { idleExitMs: options.idleExitMs }),
		tailnet: await (options.tailnet ?? readTailnet)(),
		exited: () => exited(),
		warn: (message) => err(`pi-remote daemon: ${message}`),
	});
	if (daemon === undefined) {
		err(`pi-remote: a daemon already answers on ${paths.socket}`);
		return 1;
	}
	out(
		`pi-remote ${VERSION}: bridges on ${paths.socket}, clients on 127.0.0.1:${daemon.clientPort}`,
	);
	void (options.stopped ?? signalled()).then(() => daemon.stop());
	await done;
	return 0;
}

/** The sessions of the remote's tmux; every verb but `ls` names one. */
async function desk(
	verb: "ls" | "window" | "detach" | "stop" | "move",
	names: readonly string[],
	out: (line: string) => void,
	err: (line: string) => void,
	options: RunOptions,
): Promise<number> {
	const [name] = names;
	if (verb === "ls" && names.length > 0) {
		err(`pi-remote: ls takes no arguments\n${USAGE}`);
		return 2;
	}
	if (verb !== "ls" && names.length !== 1) {
		err(`pi-remote: ${verb} takes a session's name\n${USAGE}`);
		return 2;
	}
	const verbs: DeskVerbs = {
		desk: new Desk({
			...(options.tmux === undefined ? {} : { tmux: options.tmux }),
			...(options.env === undefined ? {} : { env: options.env }),
			...(options.launch === undefined ? {} : { launch: options.launch }),
		}),
		socket: daemonPaths(daemonDir(options.env)).socket,
		out,
		...(options.resume === undefined ? {} : { resume: options.resume }),
	};
	try {
		if (verb === "ls" || name === undefined) return await list(verbs);
		if (verb === "move") return await move(name, verbs);
		return await act(verb, name, verbs);
	} catch (error) {
		err(`pi-remote: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

/** Opens the remote's tmux, or one session of it, in this terminal, and ends with tmux's exit code. */
async function attach(
	tmux: string,
	name: string | undefined,
	err: (line: string) => void,
): Promise<number> {
	const target = name === undefined ? [] : ["-t", `=${name}`];
	const has = await exitOf(tmux, ["-L", TMUX_SOCKET, "has-session", ...target], "ignore");
	if (has === undefined) {
		err("pi-remote: attach needs tmux on PATH");
		return 1;
	}
	if (has !== 0) {
		err(
			name === undefined
				? `pi-remote: no session runs in the remote's tmux (tmux -L ${TMUX_SOCKET})`
				: `pi-remote: no session named ${name} in the remote's tmux: pi-remote ls lists them`,
		);
		return 1;
	}
	return (await exitOf(tmux, ["-L", TMUX_SOCKET, "attach", ...target], "inherit")) ?? 1;
}

/** Undefined when the program does not start. */
function exitOf(
	command: string,
	args: readonly string[],
	stdio: StdioOptions,
): Promise<number | undefined> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio });
		child.on("error", () => resolve(undefined));
		child.on("exit", (code) => resolve(code ?? 1));
	});
}

/** Read without the kit, because the built command may import only Node's modules. */
export function portFromSettings(): number {
	return portOf(globalSetting(PORT_ID)) ?? CLIENT_PORT;
}

function dev(port: number, err: (line: string) => void): Promise<number> {
	const here = dirname(fileURLToPath(import.meta.url));
	// The package root is two folders up from src/cli/, one from dist/.
	const entry = [join(here, "../daemon/main.ts"), join(here, "../src/daemon/main.ts")].find(
		(path) => existsSync(path),
	);
	if (entry === undefined) {
		err("pi-remote: --dev runs from a checkout of pi-harness, and this install has no src/");
		return Promise.resolve(1);
	}
	const child = spawn("bun", ["--watch", entry, "--serve", "--port", String(port)], {
		stdio: "inherit",
	});
	return new Promise((resolve) => {
		child.on("error", () => {
			err("pi-remote: --dev needs bun on PATH");
			resolve(1);
		});
		child.on("exit", (code) => resolve(code ?? 0));
	});
}

function signalled(): Promise<void> {
	return new Promise((resolve) => {
		process.once("SIGINT", () => resolve());
		process.once("SIGTERM", () => resolve());
	});
}

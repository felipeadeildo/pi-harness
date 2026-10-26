// `pi-remote`, the command the launcher runs. It grows a subcommand with each slice of the remote,
// and until a subcommand exists it says so instead of guessing.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findWebDir } from "../daemon/app.ts";
import { Daemon } from "../daemon/server.ts";
import { readTailnet, type Tailnet } from "../daemon/tailnet.ts";
import { CLIENT_PORT, daemonDir, daemonPaths, PORT_ID, portOf, settingsPath } from "../places.ts";
import { VERSION } from "../version.ts";
import { open } from "./open.ts";

const USAGE = "usage: pi-remote --version | open | serve [--dev] [--port <n>]";

/** Runs one command line and returns the exit code, once the command is done. */
export function run(
	args: readonly string[],
	out: (line: string) => void,
	err: (line: string) => void,
	options: ServeOptions = {},
): number | Promise<number> {
	const [first, ...rest] = args;
	if (first === "--version" || first === "-v") {
		out(VERSION);
		return 0;
	}
	if (first === "serve") return serve(rest, out, err, options);
	if (first === "open") return open(daemonPaths(daemonDir()).socket, out, err);
	err(first === undefined ? USAGE : `pi-remote: unknown command "${first}"\n${USAGE}`);
	return 2;
}

export interface ServeOptions {
	/** Resolves when `serve` should stop, as SIGINT and SIGTERM do. Injected so a test can stop it. */
	stopped?: Promise<void>;
	env?: NodeJS.ProcessEnv;
	/** The web app's export. Found next to this file by default. */
	webDir?: string;
	/** The idle wait a daemon a pi started would have, so a test sees `serve` outlast it. */
	idleExitMs?: number;
	/** This machine on its tailnet, asked of `tailscale` by default. */
	tailnet?: () => Promise<Tailnet | undefined>;
}

/**
 * `serve` runs the daemon in the foreground, and it never exits for being idle. `--dev` runs it from
 * `src/` under `bun --watch`, which restarts it on every save.
 */
async function serve(
	flags: readonly string[],
	out: (line: string) => void,
	err: (line: string) => void,
	options: ServeOptions,
): Promise<number> {
	// One owner for the port: the setting `pi` writes, unless the operator typed `--port` by hand.
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

/**
 * The port the settings file names, or the default when it names none this command can use. The file
 * is read here rather than through the kit because the built command may import only Node's modules,
 * and the kit reaches the pi runtime. The key and the range are the setting's, spelled the same.
 */
export function portFromSettings(): number {
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(settingsPath(), "utf8"));
	} catch {
		return CLIENT_PORT;
	}
	if (typeof data !== "object" || data === null) return CLIENT_PORT;
	// The file is nested (`{ "remote": { "port": … } }`), the id is dotted: walking it is the same
	// lookup the kit does, written here because the built command may import only Node's modules.
	let node: unknown = data;
	for (const key of PORT_ID.split(".")) {
		if (typeof node !== "object" || node === null) return CLIENT_PORT;
		node = (node as Record<string, unknown>)[key];
	}
	return portOf(node) ?? CLIENT_PORT;
}

/** The daemon from `src/`, restarted by Bun on every save. Only a checkout of the repository has it. */
function dev(port: number, err: (line: string) => void): Promise<number> {
	const here = dirname(fileURLToPath(import.meta.url));
	// From src/cli/ and from dist/, the package's root is two folders or one folder up.
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

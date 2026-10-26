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
	/** Injected so a test can stop it. */
	stopped?: Promise<void>;
	env?: NodeJS.ProcessEnv;
	webDir?: string;
	/** So a test sees `serve` outlast a pi-started daemon. */
	idleExitMs?: number;
	tailnet?: () => Promise<Tailnet | undefined>;
}

/** Runs the daemon in the foreground, never idling out. `--dev` runs `src/` under `bun --watch`. */
async function serve(
	flags: readonly string[],
	out: (line: string) => void,
	err: (line: string) => void,
	options: ServeOptions,
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

/** Read without the kit, because the built command may import only Node's modules. */
export function portFromSettings(): number {
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(settingsPath(), "utf8"));
	} catch {
		return CLIENT_PORT;
	}
	if (typeof data !== "object" || data === null) return CLIENT_PORT;
	// The same nested lookup the kit does.
	let node: unknown = data;
	for (const key of PORT_ID.split(".")) {
		if (typeof node !== "object" || node === null) return CLIENT_PORT;
		node = (node as Record<string, unknown>)[key];
	}
	return portOf(node) ?? CLIENT_PORT;
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

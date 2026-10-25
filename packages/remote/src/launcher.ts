// Every pi start writes down the Node binary and the built files of its version, and `bin/pi-remote`
// runs them. The launcher's text never changes, so a service that points at it survives an update.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What the last pi that started with the remote wrote down. */
export interface Current {
	/** The Node binary that ran pi. */
	node: string;
	/** `dist/cli.js`. */
	cli: string;
	/** `dist/daemon.js`. */
	daemon: string;
	/** The package's version. */
	version: string;
	/** The daemon that holds the socket, once one is listening: who to stop, and on what port. */
	pid?: number;
	port?: number;
}

/**
 * The shell script, with the path of `current.sh` written into it, so a link to it still works. It
 * reads its values by sourcing a file of quoted assignments, because a path may hold any character
 * and shell cannot parse JSON.
 */
export function launcherScript(currentSh: string): string {
	return `#!/bin/sh
# pi-remote: runs the command of the version the last pi wrote down.
current=${shellQuoted(currentSh)}
if [ ! -f "$current" ]; then
	echo "pi-remote: no pi has started with the remote yet, so $current is missing" >&2
	exit 1
fi
. "$current"
if [ ! -f "$cli" ]; then
	echo "pi-remote: $cli is not built; run: bun run --cwd packages/remote build" >&2
	exit 1
fi
exec "$node" "$cli" "$@"
`;
}

/** The same values as `current.json`, as shell assignments the launcher sources. */
export function currentScript(current: Current): string {
	const lines = Object.entries(current).map(([key, value]) => `${key}=${shellQuoted(value)}`);
	return `# Written by pi at every start, for bin/pi-remote. current.json holds the same values.\n${lines.join("\n")}\n`;
}

/**
 * Writes `current.json` and `current.sh` every time, and the launcher only when its text differs, so
 * its file stays put. Each file goes through a temporary one renamed into place, created with its
 * final mode, so no reader meets half a file or a launcher it cannot run.
 */
export function writeLauncher(dir: string, current: Current): void {
	mkdirSync(join(dir, "bin"), { recursive: true });
	writeAtomically(join(dir, "current.json"), `${JSON.stringify(current, null, "\t")}\n`);
	const sh = join(dir, "current.sh");
	writeAtomically(sh, currentScript(current));
	const script = launcherScript(sh);
	const launcher = join(dir, "bin", "pi-remote");
	if (!existsSync(launcher) || readFileSync(launcher, "utf8") !== script) {
		writeAtomically(launcher, script, 0o755);
	}
}

/** What `current.json` names, or nothing when it is missing or not what a pi wrote. */
/**
 * Says which process holds the socket and on what port, for whoever has to stop it. The daemon writes
 * its own pid here: the socket is bound to a temporary name and renamed, so finding the process by the
 * socket's path finds nothing.
 */
export function writeHolder(dir: string, holder: { pid: number; port: number }): void {
	const known = readCurrent(dir);
	if (known === undefined) return;
	const current: Current = { ...known, pid: holder.pid, port: holder.port };
	writeAtomically(join(dir, "current.json"), `${JSON.stringify(current, null, "\t")}\n`);
}

export function readCurrent(dir: string): Current | undefined {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(join(dir, "current.json"), "utf8"));
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const { node, cli, daemon, version } = value as Record<string, unknown>;
	if (typeof node !== "string" || typeof cli !== "string") return undefined;
	if (typeof daemon !== "string" || typeof version !== "string") return undefined;
	const { pid, port } = value as Record<string, unknown>;
	return {
		node,
		cli,
		daemon,
		version,
		...(typeof pid === "number" ? { pid } : {}),
		...(typeof port === "number" ? { port } : {}),
	};
}

/**
 * Starts the daemon of the version the last pi wrote down, detached from this pi, so it outlives
 * the session that started it and an older pi still starts the newest daemon.
 */
export function startDaemon(dir: string, port: number): void {
	const current = readCurrent(dir);
	if (current === undefined)
		throw new Error(`${join(dir, "current.json")} names no daemon to start`);
	// The port comes from the settings the running pi read, so a machine where the default is taken
	// can be fixed without a shell and the link keeps pointing at the same address.
	const child = spawn(current.node, [current.daemon, "--port", String(port)], {
		detached: true,
		stdio: "ignore",
	});
	// A Node binary that moved since must not take pi down with it.
	child.on("error", () => {});
	child.unref();
}

function writeAtomically(path: string, text: string, mode = 0o644): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, text, { mode });
	renameSync(temporary, path);
}

/** Single quotes keep every character as it is, and a quote inside closes, escapes and reopens. */
function shellQuoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

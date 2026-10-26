// `bin/pi-remote` runs the Node binary and built files the last pi wrote down. Its text never changes,
// so a service that points at it survives updates.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Current {
	node: string;
	cli: string;
	daemon: string;
	version: string;
	pid?: number;
	port?: number;
}

/** The script sources quoted assignments, since a path may hold any character and shell cannot parse JSON. */
function launcherScript(currentSh: string): string {
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

function currentScript(current: Current): string {
	const lines = Object.entries(current).map(([key, value]) => `${key}=${shellQuoted(value)}`);
	return `# Written by pi at every start, for bin/pi-remote. current.json holds the same values.\n${lines.join("\n")}\n`;
}

/** Each file is renamed into place with its final mode, so no reader meets half a file. */
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

/** The socket is bound under a temporary name, so its path does not find the process. */
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

/** Detached, so it outlives this session and an older pi still starts the newest daemon. */
export function startDaemon(dir: string, port: number): void {
	const current = readCurrent(dir);
	if (current === undefined)
		throw new Error(`${join(dir, "current.json")} names no daemon to start`);
	// From the settings, so a taken default port is fixed without a shell.
	const child = spawn(current.node, [current.daemon, "--port", String(port)], {
		detached: true,
		stdio: "ignore",
	});
	child.on("error", () => {});
	child.unref();
}

function writeAtomically(path: string, text: string, mode = 0o644): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, text, { mode });
	renameSync(temporary, path);
}

function shellQuoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

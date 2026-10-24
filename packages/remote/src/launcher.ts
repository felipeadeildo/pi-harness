// The way into the built command that survives updates. Every pi start writes down the Node binary
// and the built files of its version, and `bin/pi-remote` runs them. The launcher's text never
// changes, so a service or a link that points at it keeps working when pi updates and the package
// moves on disk.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What the last pi that started with the remote wrote down. */
export interface Current {
	/** The Node binary that ran pi, which runs the built files too. */
	node: string;
	/** The built command, `dist/cli.js`. */
	cli: string;
	/** The built daemon, `dist/daemon.js`. */
	daemon: string;
	/** The package's version. */
	version: string;
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

function writeAtomically(path: string, text: string, mode = 0o644): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, text, { mode });
	renameSync(temporary, path);
}

/** Single quotes keep every character as it is, and a quote inside closes, escapes and reopens. */
function shellQuoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

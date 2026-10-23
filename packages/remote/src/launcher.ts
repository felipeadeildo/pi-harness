// The way into the built command that survives updates. `current.json` names the Node binary and
// the built files of the version that started last, and `bin/pi-remote` runs them. The launcher's
// text never changes, so a service or a link that points at it keeps working when pi updates and
// the package moves on disk.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/** The shell script, with the path of `current.json` written into it, so a link to it still works. */
export function launcherScript(current: string): string {
	return `#!/bin/sh
# pi-remote: runs the command of the version the last pi wrote down in current.json.
current=${shellQuoted(current)}
if [ ! -f "$current" ]; then
	echo "pi-remote: no pi has started with the remote yet, so $current is missing" >&2
	exit 1
fi
node=$(sed -n 's/^[[:space:]]*"node": "\\(.*\\)",\\{0,1\\}$/\\1/p' "$current")
cli=$(sed -n 's/^[[:space:]]*"cli": "\\(.*\\)",\\{0,1\\}$/\\1/p' "$current")
if [ ! -f "$cli" ]; then
	echo "pi-remote: $cli is not built; run: bun run --cwd packages/remote build" >&2
	exit 1
fi
exec "$node" "$cli" "$@"
`;
}

/**
 * Writes `current.json` every time, and the launcher only when its text differs, so its file and its
 * mode stay put. Each file goes through a temporary one renamed into place, so the launcher never
 * reads half of either.
 */
export function writeLauncher(dir: string, current: Current): void {
	mkdirSync(join(dir, "bin"), { recursive: true });
	const json = join(dir, "current.json");
	writeAtomically(json, `${JSON.stringify(current, null, "\t")}\n`);
	const script = launcherScript(json);
	const launcher = join(dir, "bin", "pi-remote");
	if (!existsSync(launcher) || readFileSync(launcher, "utf8") !== script) {
		writeAtomically(launcher, script);
		chmodSync(launcher, 0o755);
	}
}

function writeAtomically(path: string, text: string): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, text);
	renameSync(temporary, path);
}

function shellQuoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

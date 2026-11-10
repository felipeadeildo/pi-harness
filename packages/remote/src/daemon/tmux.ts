// The remote's own tmux server (`tmux -L pi-remote`), where the page's sessions and terminals run.
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

import { Refused } from "./refused.ts";

/**
 * Pi tells Shift+Enter from Enter only through extended keys (pi's docs, tmux.md); set before the
 * session, so pi's request at start is honored. `-q` skips an option an older tmux lacks.
 */
export const EXTENDED_KEYS = [
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
];

/** An absolute folder, or one under `~`, that exists. */
export async function folderOf(folder: string): Promise<string> {
	const path = folder.replace(/^~(?=\/|$)/, homedir());
	if (!isAbsolute(path))
		throw new Refused(400, "the folder must be an absolute path or start with ~");
	const real = await realpath(path).catch(() => {
		throw new Refused(404, `there is no folder at ${folder}`);
	});
	if (!(await stat(real)).isDirectory())
		throw new Refused(400, `${folder} is a file, not a folder`);
	return real;
}

/** `code` is undefined when the program could not start. */
export function run(
	command: string,
	args: readonly string[],
): Promise<{ code: number | undefined; out: string; err: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
			out += chunk;
		});
		child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
			err += chunk;
		});
		child.once("error", () => resolve({ code: undefined, out, err }));
		child.once("close", (code) => resolve({ code: code ?? 1, out, err }));
	});
}

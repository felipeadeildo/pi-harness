// The protected list ends every shortcut: a call that touches an entry is asked about in every
// mode but `full`. The remote puts its key, its socket and its command here, so an agent cannot
// answer its own permission question or drive a session from a second tool call.
import { homedir } from "node:os";
import { basename } from "node:path";

import { type ProtectedList, tildify } from "@adeildo/pi-kit";

import type { Call } from "#core/decide.ts";
import { tokenize } from "#core/tools.ts";
import { canonical, isInside, resolvePath } from "#core/workspace.ts";

/**
 * The first entry the call touches, as the dialog names it, or undefined when it touches none.
 *
 * It reads what the call names, not what it does: a path in a variable, in a script it runs or in
 * a tool that declares no paths gets past it. The remote keeps its own checks for that reason.
 */
export function protectedEntry(call: Call, list: ProtectedList): string | undefined {
	const cwd = call.cwd ?? process.cwd();
	const command = typeof call.input.command === "string" ? call.input.command : undefined;
	const words = command === undefined ? [] : piecesOf(tokenize(command));
	const paths = [...(call.tool.paths(call.input) ?? []), ...words];

	// Through `~`, `$HOME` and symlinks, so a link to the key or a relative path to it is the key.
	const where = (path: string) => canonical(resolvePath(path.replace(HOME_VARIABLE, "~"), cwd));
	const reached = paths.map(where);
	// The home and the root hold everything, and asking about each `ls ~` would teach you to say
	// yes. A call that walks down from them reaches the entry, though.
	const wide = walks(call, words) ? new Set() : new Set([canonical(homedir()), canonical("/")]);
	for (const entry of [...list.paths, ...list.sockets.filter(isPath)].map(where)) {
		// A folder above the entry reaches it too, as a recursive grep would.
		const reaches = (path: string) =>
			isInside(path, [entry]) || (!wide.has(path) && isInside(entry, [path]));
		if (reached.some(reaches)) return tildify(entry);
	}
	for (const socket of list.sockets.filter((entry) => !isPath(entry))) {
		// The port names the socket, whatever the host is called, `nc host port` included.
		const port = socket.slice(socket.lastIndexOf(":") + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const named = new RegExp(`(^|:)${port}(\\D|$)`);
		if (words.some((word) => named.test(word))) return socket;
	}
	for (const name of list.commands) {
		if (words.some((word) => basename(word) === name)) return name;
	}
	return undefined;
}

/**
 * Every word of a command, and the pieces a word hides: `sh -c "pi-remote x"`, `a;b`, `-d @key`,
 * `--file=key`, `open('key')` and `UNIX-CONNECT:/sock` each name what is inside them.
 */
function piecesOf(words: string[]): string[] {
	const pieces = words.flatMap((word) => [word, ...word.split(/[\s;|&()'"`<>=@,:]+/)]);
	return [...new Set(pieces.filter((piece) => piece !== ""))];
}

const HOME_VARIABLE = /^\$\{?HOME\}?(?=\/|$)/;

const WALKERS = new Set(["find", "rg", "tar", "zip", "rsync", "du", "tree"]);

/** Whether the call goes down through the folders it names, rather than looking at them. */
function walks(call: Call, words: string[]): boolean {
	if (call.toolName === "grep" || call.toolName === "find") return true;
	return words.some(
		(word) =>
			WALKERS.has(basename(word)) ||
			/^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(word) ||
			word === "--recursive",
	);
}

function isPath(socket: string): boolean {
	return socket.startsWith("/") || socket.startsWith("~");
}

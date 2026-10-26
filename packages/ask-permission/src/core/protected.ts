// A call touching a protected entry is asked about in every mode but `full`. The remote protects its
// key, socket and command here, so an agent cannot answer its own permission question.
import { homedir } from "node:os";
import { basename } from "node:path";

import { type ProtectedList, tildify } from "@adeildo/pi-kit";

import type { Call } from "#core/decide.ts";
import { tokenize } from "#core/tools.ts";
import { canonical, isInside, resolvePath } from "#core/workspace.ts";

/** Reads what the call names, not what it does, so the remote keeps its own checks too. */
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

/** `sh -c "pi-remote x"`, `a;b`, `-d @key`, `--file=key`, `open('key')`, `UNIX-CONNECT:/sock`. */
function piecesOf(words: string[]): string[] {
	const pieces = words.flatMap((word) => [word, ...word.split(/[\s;|&()'"`<>=@,:]+/)]);
	return [...new Set(pieces.filter((piece) => piece !== ""))];
}

const HOME_VARIABLE = /^\$\{?HOME\}?(?=\/|$)/;

const WALKERS = new Set(["find", "rg", "tar", "zip", "7z", "rsync", "du", "tree"]);

/** Whether the call goes down through the folders it names, rather than looking at them. */
function walks(call: Call, words: string[]): boolean {
	if (call.toolName === "grep" || call.toolName === "find") return true;
	// `cp -a` copies a folder whole; `ls -a` only lists it, so `-a` counts for `cp` alone.
	const copies = words.some((word) => basename(word) === "cp");
	if (copies && words.some((word) => word === "--archive" || /^-[a-zA-Z]*a/.test(word)))
		return true;
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

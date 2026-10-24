// The protected list ends every shortcut: a call that touches an entry is asked about in every
// mode but `full`. The remote puts its key, its socket and its command here, so an agent cannot
// answer its own permission question or drive a session from a second tool call.
import { basename } from "node:path";

import { type ProtectedList, tildify } from "@adeildo/pi-kit";

import type { Call } from "#core/decide.ts";
import { tokenize } from "#core/tools.ts";
import { canonical, isInside, resolvePath } from "#core/workspace.ts";

/** The first entry the call touches, as the dialog names it, or undefined when it touches none. */
export function protectedEntry(call: Call, list: ProtectedList): string | undefined {
	const cwd = call.cwd ?? process.cwd();
	const command = typeof call.input.command === "string" ? call.input.command : undefined;
	const words = command === undefined ? [] : tokenize(command);
	const paths = [...(call.tool.paths(call.input) ?? []), ...words];

	// Through `~` and symlinks, so a link to the key or a relative path to it is the key.
	const where = (path: string) => canonical(resolvePath(path, cwd));
	const reached = paths.map(where);
	for (const entry of [...list.paths, ...list.sockets.filter(isPath)].map(where)) {
		if (reached.some((path) => isInside(path, [entry]))) return tildify(entry);
	}
	for (const socket of list.sockets.filter((entry) => !isPath(entry))) {
		if (words.some((word) => word.includes(socket))) return socket;
	}
	for (const name of list.commands) {
		if (words.some((word) => basename(word) === name)) return name;
	}
	return undefined;
}

function isPath(socket: string): boolean {
	return socket.startsWith("/") || socket.startsWith("~");
}

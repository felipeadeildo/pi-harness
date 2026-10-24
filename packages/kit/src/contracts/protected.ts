// What the permission feature always asks about, in every mode but `full`. Several features can
// add to it, so a reader collects every provider's entries instead of taking one answer.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

export const PROTECTED = "harness:protected";

export interface ProtectedList {
	/** A file or a folder, with everything under it. `~` stands for the home folder. */
	paths: string[];
	/** A Unix socket's path, matched as a path, or a `host:port`, matched in a command's words. */
	sockets: string[];
	/** A program's name, matched against the name of every word of a command. */
	commands: string[];
}

const KEYS = ["paths", "sockets", "commands"] as const;

/** Every entry that the features of this process protect, collected now. */
export function protectedList(events: Events): ProtectedList {
	const list: ProtectedList = { paths: [], sockets: [], commands: [] };
	events.emit(PROTECTED, list);
	return list;
}

/** Adds entries to every collection, read when it runs, so they may change. Returns the stop. */
export function provideProtected(
	events: Events,
	entries: () => Partial<ProtectedList>,
): () => void {
	return events.on(PROTECTED, (data) => {
		if (!isObject(data)) return;
		const added = entries();
		for (const key of KEYS) {
			const into = data[key];
			if (Array.isArray(into)) into.push(...(added[key] ?? []));
		}
	});
}

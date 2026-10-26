// What the permission feature asks about in every mode but `full`. Several features add to it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

export const PROTECTED = "harness:protected";

export interface ProtectedList {
	/** Everything under a folder too. `~` is the home folder. */
	paths: string[];
	/** A socket path, matched as a path, or a `host:port`, matched in a command's words. */
	sockets: string[];
	/** Matched against the name of every word of a command. */
	commands: string[];
}

const KEYS = ["paths", "sockets", "commands"] as const;

export function protectedList(events: Events): ProtectedList {
	const list: ProtectedList = { paths: [], sockets: [], commands: [] };
	events.emit(PROTECTED, list);
	return list;
}

/** Read when it runs, so the entries may change. */
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

// What a client keeps of a session between visits, keyed by machine, session and cursor. The screen
// draws the cache before the network answers, which is what makes opening a session feel instant.

import type { Cursor } from "./cursor.ts";

export interface SessionKey {
	machine: string;
	session: string;
}

/** What a session looks like on disk or in the browser's store. */
export interface CachedSession {
	key: SessionKey;
	cursor: Cursor;
	/** pi's entries of the branch the client held, oldest first. */
	entries: unknown[];
	/** The harness's facts, in the order the log wrote them. */
	facts: { type: string; data: unknown }[];
}

export interface Cache {
	read(key: SessionKey): Promise<CachedSession | undefined>;
	write(value: CachedSession): Promise<void>;
	/** Forgets a session, when the owner does not know the cursor or the machine was unlinked. */
	drop(key: SessionKey): Promise<void>;
}

/** The cache of a client that lives as long as the process does, and of every test. */
export function memoryCache(): Cache {
	const held = new Map<string, CachedSession>();
	const keyOf = (key: SessionKey) => `${key.machine}\n${key.session}`;
	return {
		read: async (key) => held.get(keyOf(key)),
		write: async (value) => {
			held.set(keyOf(value.key), value);
		},
		drop: async (key) => {
			held.delete(keyOf(key));
		},
	};
}

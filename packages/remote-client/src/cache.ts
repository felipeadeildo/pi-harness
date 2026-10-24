// What a client keeps of a session between visits, keyed by machine, session and cursor. The screen
// draws the cache before the network answers, which is what makes opening a session feel instant.

import type { SessionState, Presence } from "@adeildo/pi-remote-protocol";

import type { Cursor } from "./cursor.ts";
import type { Outgoing } from "./outbox.ts";

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
	/** What the harness knew of the session, folded, so a warm open draws tasks and questions. */
	state: SessionState;
	/** Where the branch ended, as the bridge last said; see `ClientSession.leaf`. */
	leaf?: string | null;
	/** Who was watching when the page closed, so a warm open does not draw nobody. */
	presence?: Presence;
	/**
	 * What the person typed and has not been answered yet. A phone kills the tab without asking, and
	 * losing a prompt that was typed offline is losing the reason the queue exists.
	 */
	outbox?: Outgoing[];
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

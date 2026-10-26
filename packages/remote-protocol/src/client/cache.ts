// Keyed by machine, session and cursor; the screen draws it before the network answers.

import type { SessionState, Presence } from "../index.ts";
import type { Cursor } from "./cursor.ts";
import type { Outgoing } from "./outbox.ts";

export interface SessionKey {
	machine: string;
	session: string;
}

export interface CachedSession {
	key: SessionKey;
	cursor: Cursor;
	entries: unknown[];
	/** Folded, so a warm open draws the board and the questions. */
	state: SessionState;
	/** See `ClientSession.leaf`. */
	leaf?: string | null;
	/** So a warm open does not draw nobody. */
	presence?: Presence;
	/** Kept because a phone kills the tab without asking. */
	outbox?: Outgoing[];
}

export interface Cache {
	read(key: SessionKey): Promise<CachedSession | undefined>;
	write(value: CachedSession): Promise<void>;
	drop(key: SessionKey): Promise<void>;
}

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

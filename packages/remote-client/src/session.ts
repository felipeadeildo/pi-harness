// A session as the client holds it: the branch, the state beside it, and the cursor a reconnect sends.

import {
	applyChange,
	emptySessionState,
	type SessionState,
	isStateChangeType,
	PRESENCE,
	isEnvelope,
	isObject,
	isPresence,
	isSummary,
	type Envelope,
	type Entry,
	type Presence,
	type SessionSummary,
	type Transcript,
	transcriptOf,
} from "@adeildo/pi-remote-protocol";

import type { CachedSession, SessionKey } from "./cache.ts";
import { advance, decide, type Cursor } from "./cursor.ts";
import type { Outbox } from "./outbox.ts";

export const CHANGES = "entry";
export const ENTRY = CHANGES;
export const STATE = "state";

export interface SnapshotData {
	summary: SessionSummary;
	entries: Entry[];
	state?: SessionState;
}

export interface ClientSession {
	key: SessionKey;
	cursor: Cursor;
	entries: Entry[];
	/** The folded state, read the way the daemon reads it, so both hold the same. */
	state: SessionState;
	summary?: SessionSummary;
	/** Who opens the session and who typed last, as the daemon last said. */
	presence?: Presence;
	/** `null` is the root; `undefined` means no opening said yet and the last entry stands. */
	leaf?: string | null;
	/** The messages being written, by the number the bridge gives the stream. */
	streamed: Record<string, unknown>;
}

export function sessionOf(key: SessionKey, cached?: CachedSession): ClientSession {
	return {
		key,
		cursor: cached?.cursor ?? {},
		entries: (cached?.entries ?? []) as Entry[],
		state: cached?.state ?? emptySessionState(),
		leaf: cached?.leaf,
		// A cache can be days old, so a stored `active` is dropped on the way in.
		presence: cached?.presence === undefined ? undefined : { viewers: cached.presence.viewers },
		streamed: {},
	};
}

/** The branch as the protocol reduces it, from the leaf the bridge named. */
export function transcriptOfSession(session: ClientSession): Transcript {
	// At the root there is no branch to walk: the entries the client holds came after the move.
	if (session.leaf === null) return { items: [] };
	return transcriptOf(session.entries, session.leaf ?? session.cursor.entry);
}

/** The tasks, rulings, questions, mode and rename, as the client holds them. */
export function harnessOf(session: ClientSession): SessionState {
	return session.state;
}

/** What the next visit draws at once, with the commands nobody answered. */
export function cachedOf(session: ClientSession, outbox: Outbox): CachedSession {
	return {
		key: session.key,
		cursor: session.cursor,
		entries: session.entries,
		state: session.state,
		leaf: session.leaf,
		presence: session.presence,
		...(outbox === undefined || outbox.all().length === 0 ? {} : { outbox: outbox.all() }),
	};
}

/**
 * Reads one envelope. The answer says whether the client can draw it now or has to ask for a
 * snapshot first, and the session is only changed in the first case.
 */
function isSummaryData(value: unknown): value is SnapshotData {
	return isObject(value) && isSummary(value.summary) && Array.isArray(value.entries);
}

/**
 * What reading an envelope did. `now` carries the session **after** it: reading never mutates the session
 * it was given, so two readers holding one session cannot change each other, and a view that memoises by
 * identity sees a new object exactly when something changed.
 */
export type Read =
	| { read: "skip" }
	| { read: "state"; why: "new" | "epoch" | "gap" }
	| { read: "now"; session: ClientSession };

export function readEnvelope(session: ClientSession, value: unknown): Read {
	if (!isEnvelope(value)) return { read: "skip" };
	// The opening answers every way of being lost, so it is read before the cursor.
	if (value.type === STATE) {
		if (!isSummaryData(value.data)) return { read: "skip" };
		const data = value.data;
		const watching = data.summary?.viewers;
		const last = data.entries.at(-1);
		// No entries leaves no leaf, and the old one named an entry the client no longer holds.
		const leaf = data.summary?.leaf ?? last?.id;
		return {
			read: "now",
			session: {
				...session,
				summary: data.summary,
				presence:
					watching === undefined
						? session.presence
						: {
								viewers: watching,
								...(data.summary?.active === undefined ? {} : { active: data.summary.active }),
							},
				entries: data.entries,
				state: data.state ?? session.state,
				leaf,
				cursor: { ...advance(session.cursor, value), entry: leaf ?? undefined },
			},
		};
	}
	const next = decide(session.cursor, value);
	if (next.read !== "now") return next;
	if (value.type === ENTRY) {
		const entry = value.data as Entry;
		const held = session.entries.some((one) => one.id === entry.id);
		return {
			read: "now",
			session: {
				...session,
				entries: held ? session.entries : [...session.entries, entry],
				leaf: entry.id,
				cursor: { ...advance(session.cursor, value), entry: entry.id },
			},
		};
	}
	// Presence is not a state change: reducing it from a replay would draw who was watching ten minutes ago.
	if (value.type === PRESENCE) {
		if (!isPresence(value.data)) return { read: "skip" };
		return {
			read: "now",
			session: { ...session, presence: value.data, cursor: advance(session.cursor, value) },
		};
	}
	if (isStateChangeType(value.type)) {
		const leaf =
			value.type === "leaf.changed" ? (value.data as { leaf: string | null }).leaf : null;
		// A leaf the client does not hold is a branch it never read: only the whole state can put it back.
		if (leaf !== null && !session.entries.some((held) => held.id === leaf))
			return { read: "state", why: "gap" };
		return {
			read: "now",
			session: {
				...session,
				state: applyChange(session.state, value.type, value.data),
				...(value.type === "leaf.changed" ? { leaf } : {}),
				cursor: {
					...advance(session.cursor, value),
					...(value.type === "leaf.changed" ? { entry: leaf ?? undefined } : {}),
				},
			},
		};
	}
	return { read: "now", session: { ...session, cursor: advance(session.cursor, value) } };
}

/** The hello a client sends, which is what tells the bridge where the client stopped reading. */
export function hello(session: ClientSession): Envelope {
	return {
		v: 1,
		kind: "hello",
		machine: session.key.machine,
		session: session.key.session,
		type: "hello",
		data: { cursor: session.cursor },
		at: Date.now(),
	};
}

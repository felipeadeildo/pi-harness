// A session as the client holds it: the entries of the branch, the facts of the log, and the cursor
// the reconnect sends. Reading an envelope is the only way it changes, which is what keeps a gap and
// a duplicate impossible.

import {
	FACT_TYPES,
	isEnvelope,
	isObject,
	type Envelope,
	type Entry,
	type SessionFacts,
	type SessionSnapshot,
	type Transcript,
	type FactType,
	reduceFact,
	emptySessionFacts,
	transcriptOf,
} from "@adeildo/pi-remote-protocol";

import type { CachedSession, SessionKey } from "./cache.ts";
import { advance, decide, type Cursor } from "./cursor.ts";

/** The envelope a bridge sends for an entry pi appended, and for the snapshot it is asked for. */
export const ENTRY = "entry";
export const SNAPSHOT = "snapshot";

export interface SnapshotData {
	snapshot: SessionSnapshot;
	/** The tail of the branch, oldest first, which is what a screen draws first. */
	entries: Entry[];
	/** The log's facts up to the snapshot, so the tasks are there before the next one arrives. */
	facts?: { type: string; data: unknown }[];
}

export interface ClientSession {
	key: SessionKey;
	cursor: Cursor;
	entries: Entry[];
	facts: { type: string; data: unknown }[];
	snapshot?: SessionSnapshot;
	/**
	 * Where the branch ends, as the bridge last said. `null` means the root: the reader is at a point
	 * before the first entry, which a `/tree` move can reach, and `undefined` means the snapshot has
	 * not said yet and the last entry held stands.
	 */
	leaf?: string | null;
	/**
	 * The live messages being written, by the number the bridge gives the stream. Nothing writes it
	 * until the client speaks WebSocket; the field is here so the shape does not move under it.
	 */
	streamed: Record<string, unknown>;
}

export function sessionOf(key: SessionKey, cached?: CachedSession): ClientSession {
	return {
		key,
		cursor: cached?.cursor ?? {},
		entries: (cached?.entries ?? []) as Entry[],
		facts: cached?.facts ?? [],
		leaf: cached?.leaf,
		streamed: {},
	};
}

/** What the screen draws: the branch as the protocol reduces it, from the leaf the bridge named. */
export function transcriptOfSession(session: ClientSession): Transcript {
	// At the root there is no branch to walk: the entries the client holds came after the move.
	if (session.leaf === null) return { items: [] };
	return transcriptOf(session.entries, session.leaf ?? session.cursor.entry);
}

/** The tasks, rulings, questions, mode and rename of the session, from its log. */
export function factsOf(session: ClientSession): SessionFacts {
	let state = emptySessionFacts();
	for (const fact of session.facts) state = reduceFact(state, fact.type, fact.data);
	return state;
}

/** What to keep so the next visit draws at once. */
export function cachedOf(session: ClientSession): CachedSession {
	return {
		key: session.key,
		cursor: session.cursor,
		entries: session.entries,
		facts: session.facts,
		leaf: session.leaf,
	};
}

function isFactType(type: string): type is FactType {
	return FACT_TYPES.some((known) => known === type);
}

/**
 * Reads one envelope. The answer says whether the client can draw it now or has to ask for a
 * snapshot first, and the session is only changed in the first case.
 */
export function readEnvelope(
	session: ClientSession,
	value: unknown,
): { read: "now" } | { read: "snapshot"; why: "new" | "epoch" | "gap" } | { read: "skip" } {
	if (!isEnvelope(value)) return { read: "skip" };
	// The snapshot is the answer to every way of being lost, so it is read before the cursor is
	// consulted: a client that asked for one has nothing to compare its epoch against.
	if (value.type === SNAPSHOT) {
		// The snapshot replaces the whole state at once, so its shape is checked before the swap:
		// an envelope that decodes is not the same as a snapshot that does.
		if (!isObject(value.data) || !Array.isArray(value.data.entries)) return { read: "skip" };
		const data = value.data as unknown as SnapshotData;
		session.snapshot = data.snapshot;
		session.entries = data.entries;
		session.facts = data.facts ?? session.facts;
		const last = data.entries.at(-1);
		// A snapshot with no entries leaves no leaf to point at, and the old one named an entry the
		// client no longer holds.
		session.leaf = last?.id;
		session.cursor = { ...advance(session.cursor, value), entry: last?.id };
		return { read: "now" };
	}
	const next = decide(session.cursor, value);
	if (next.read !== "now") return next;
	if (value.type === ENTRY) {
		const entry = value.data as Entry;
		// A message pi wrote after the client read it through the stream replaces the copy it bound.
		if (!session.entries.some((held) => held.id === entry.id)) session.entries.push(entry);
		session.leaf = entry.id;
		session.cursor = { ...advance(session.cursor, value), entry: entry.id };
		return { read: "now" };
	}
	if (isFactType(value.type)) {
		session.facts.push({ type: value.type, data: value.data });
		session.cursor = advance(session.cursor, value);
		if (value.type === "leaf.changed") {
			// A `/tree` move, including the one back to the root: the branch the screen draws ends
			// where the bridge says, not where the last entry the client happens to hold ends.
			const leaf = (value.data as { leaf: string | null }).leaf;
			session.leaf = leaf;
			session.cursor = { ...session.cursor, entry: leaf ?? undefined };
		}
		return { read: "now" };
	}
	session.cursor = advance(session.cursor, value);
	return { read: "now" };
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

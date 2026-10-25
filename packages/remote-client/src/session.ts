// A session as the client holds it: the entries of the branch, the harness state beside it, and the
// cursor the reconnect sends. Reading an envelope is the only way it changes, which is what keeps a
// gap and a duplicate impossible.

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

/** The envelope a bridge sends for an entry pi appended, and for the snapshot it is asked for. */
export const CHANGES = "entry";
export const STATE = "state";

export interface SnapshotData {
	summary: SessionSummary;
	/** The tail of the branch, oldest first, which is what a screen draws first. */
	entries: Entry[];
	/** What the session knew when the snapshot was taken, already folded, so no replay is needed. */
	state?: SessionState;
}

export interface ClientSession {
	key: SessionKey;
	cursor: Cursor;
	entries: Entry[];
	/**
	 * What the harness knows about this session, folded the way the daemon folds it: the tasks beside
	 * it, the questions and who answered them, the rulings, the mode and the rename. One reader of the
	 * log, so the state a client draws is the state the daemon holds.
	 */
	state: SessionState;
	summary?: SessionSummary;
	/** Who has the session open and who typed last, as the daemon last said. */
	presence?: Presence;
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
		state: cached?.state ?? emptySessionState(),
		leaf: cached?.leaf,
		// `viewers` only says people were there, while `active` says someone is typing now, and a cache
		// can be days old. The cut happens here, on the way in, so it also covers a file written before
		// this rule existed; the `active` comes back from the snapshot or the next `presence.changed`.
		presence: cached?.presence === undefined ? undefined : { viewers: cached.presence.viewers },
		streamed: {},
	};
}

/** What the screen draws: the branch as the protocol reduces it, from the leaf the bridge named. */
export function transcriptOfSession(session: ClientSession): Transcript {
	// At the root there is no branch to walk: the entries the client holds came after the move.
	if (session.leaf === null) return { items: [] };
	return transcriptOf(session.entries, session.leaf ?? session.cursor.entry);
}

/** The tasks, rulings, questions, mode and rename of the session, as the client holds them. */
export function harnessOf(session: ClientSession): SessionState {
	return session.state;
}

/** What to keep so the next visit draws at once, with the commands nobody answered yet. */
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
/**
 * Whether a `state` envelope carries a snapshot this version can swap in. The whole state is replaced
 * at once, so every field the swap reads is checked before it happens: half a snapshot is worse than
 * none, because the half that arrived would look like the truth.
 */
function isSummaryData(value: unknown): value is SnapshotData {
	return isObject(value) && isSummary(value.summary) && Array.isArray(value.entries);
}

export function readEnvelope(
	session: ClientSession,
	value: unknown,
): { read: "now" } | { read: "state"; why: "new" | "epoch" | "gap" } | { read: "skip" } {
	if (!isEnvelope(value)) return { read: "skip" };
	// The snapshot is the answer to every way of being lost, so it is read before the cursor is
	// consulted: a client that asked for one has nothing to compare its epoch against.
	if (value.type === STATE) {
		// The snapshot replaces the whole state at once, so its shape is checked before the swap:
		// an envelope that decodes is not the same as a snapshot that does.
		if (!isSummaryData(value.data)) return { read: "skip" };
		const data = value.data;
		session.summary = data.summary;
		// A snapshot carries who is watching now, which is what makes the first draw right instead of
		// showing whoever was there when the page closed. Absent means the fields are not known yet.
		const watching = data.summary?.viewers;
		if (watching !== undefined)
			session.presence = {
				viewers: watching,
				...(data.summary?.active === undefined ? {} : { active: data.summary.active }),
			};
		session.entries = data.entries;
		session.state = data.state ?? session.state;
		const last = data.entries.at(-1);
		// A snapshot with no entries leaves no leaf to point at, and the old one named an entry the
		// client no longer holds.
		// The snapshot may name the leaf itself; the last entry is the fallback the format allows.
		session.leaf = data.summary?.leaf ?? last?.id;
		session.cursor = { ...advance(session.cursor, value), entry: session.leaf ?? undefined };
		return { read: "now" };
	}
	const next = decide(session.cursor, value);
	if (next.read !== "now") return next;
	if (value.type === CHANGES) {
		const entry = value.data as Entry;
		// A message pi wrote after the client read it through the stream replaces the copy it bound.
		if (!session.entries.some((held) => held.id === entry.id)) session.entries.push(entry);
		session.leaf = entry.id;
		session.cursor = { ...advance(session.cursor, value), entry: entry.id };
		return { read: "now" };
	}
	// Presence is not a state change: reducing it from a replay would draw who was watching ten minutes ago.
	// It is applied as it arrives, and the snapshot of a reconnect carries the current one.
	if (value.type === PRESENCE) {
		if (!isPresence(value.data)) return { read: "skip" };
		session.presence = value.data;
		session.cursor = advance(session.cursor, value);
		return { read: "now" };
	}
	if (isStateChangeType(value.type)) {
		if (value.type === "leaf.changed") {
			const leaf = (value.data as { leaf: string | null }).leaf;
			// A leaf the client does not hold is a branch it never read: a sibling, or one older than
			// the snapshot. Only a snapshot can put it back, so nothing is applied here.
			if (leaf !== null && !session.entries.some((held) => held.id === leaf)) {
				return { read: "state", why: "gap" };
			}
		}
		// The cursor is what keeps this from replaying: a change already folded into the state a snapshot
		// carried has a seq at or behind the cursor, so it never reaches here twice.
		session.state = applyChange(session.state, value.type, value.data);
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

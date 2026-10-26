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
} from "../index.ts";
import type { CachedSession, SessionKey } from "./cache.ts";
import { advance, decide, type Cursor } from "./cursor.ts";
import {
	foldLive,
	isLiveType,
	type Live,
	liveFromOpening,
	NOTHING_LIVE,
	settledBy,
} from "./live.ts";
import type { Outbox } from "./outbox.ts";

export const ENTRY = "entry";
export const STATE = "state";

export interface OpeningData {
	summary: SessionSummary;
	entries: Entry[];
	/** The answer being written when the opening was built. */
	streaming?: unknown;
}

export interface ClientSession {
	key: SessionKey;
	cursor: Cursor;
	entries: Entry[];
	state: SessionState;
	summary?: SessionSummary;
	presence?: Presence;
	/** `null` is the root; `undefined` means no opening said it yet and the last entry stands. */
	leaf?: string | null;
	live: Live;
}

export function sessionOf(key: SessionKey, cached?: CachedSession): ClientSession {
	return {
		key,
		cursor: cached?.cursor ?? {},
		entries: (cached?.entries ?? []) as Entry[],
		state: cached?.state ?? emptySessionState(),
		leaf: cached?.leaf,
		// A cache can be days old, so a stored `active` is dropped.
		presence: cached?.presence === undefined ? undefined : { viewers: cached.presence.viewers },
		live: NOTHING_LIVE,
	};
}

export function transcriptOfSession(session: ClientSession): Transcript {
	// At the root, the entries the client holds came after the move.
	if (session.leaf === null) return { items: [] };
	return transcriptOf(session.entries, session.leaf ?? session.cursor.entry);
}

export function harnessOf(session: ClientSession): SessionState {
	return session.state;
}

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

function isSummaryData(value: unknown): value is OpeningData {
	return isObject(value) && isSummary(value.summary) && Array.isArray(value.entries);
}

/** Reading never mutates the session it was given; `now` is a new object exactly when something changed. */
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
				state: data.summary.state ?? session.state,
				live: data.entries.reduce(settledBy, liveFromOpening(session.live, data.streaming)),
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
				live: settledBy(session.live, entry),
				leaf: entry.id,
				cursor: { ...advance(session.cursor, value), entry: entry.id },
			},
		};
	}
	if (isLiveType(value.type)) {
		const at = typeof value.at === "number" ? value.at : Date.now();
		return {
			read: "now",
			session: {
				...session,
				live: foldLive(session.live, value.type, value.data, at),
				state: piState(session.state, value.type, value.data),
				cursor: advance(session.cursor, value),
			},
		};
	}
	// Reducing presence from a replay would draw who was watching ten minutes ago.
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
		// A leaf the client does not hold is a branch it never read.
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

/** Pi's own changes of model, thinking level and name, in pi's JSON-mode shapes. */
function piState(state: SessionState, type: string, data: unknown): SessionState {
	if (!isObject(data)) return state;
	if (type === "pi.model_select" && isObject(data.model)) {
		const { provider, id } = data.model;
		return typeof provider === "string" && typeof id === "string"
			? { ...state, model: { provider, id } }
			: state;
	}
	if (type === "pi.thinking_level_select" && typeof data.level === "string")
		return { ...state, thinkingLevel: data.level };
	if (type === "pi.session_info_changed") {
		const { name: _old, ...rest } = state;
		return typeof data.name === "string" ? { ...rest, name: data.name } : rest;
	}
	return state;
}

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

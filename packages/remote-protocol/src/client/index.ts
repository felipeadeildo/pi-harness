// A client of pi-remote: the cursor it resumes from, the cache it draws first, and the session it
// rebuilds from what crossed the wire. No React here; the app is a consumer.
export { type Cache, type CachedSession, memoryCache, type SessionKey } from "./cache.ts";
export type { By } from "../index.ts";
export { type Client, type ConnectionOptions, connect, type Transport } from "./connection.ts";
export { advance, type Cursor, decide, type Next } from "./cursor.ts";
export {
	DaemonAnswer,
	inOrder,
	type ListedSession,
	type LiveSession,
	listSessions,
	stateOf,
	wantsYou,
} from "./sessions.ts";
export {
	cachedOf,
	type ClientSession,
	ENTRY,
	harnessOf,
	hello,
	readEnvelope,
	STATE,
	type SnapshotData,
	sessionOf,
	transcriptOfSession,
} from "./session.ts";
export {
	GOES_ALONE,
	Outbox,
	type CommandState,
	type OutboxOptions,
	type Outgoing,
} from "./outbox.ts";

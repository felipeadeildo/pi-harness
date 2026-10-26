// The daemon's list of sessions, as a client reads it. One request, one shape, and no React: the
// screen that draws it decides what to show, and the app can be read by anything that speaks fetch.
import {
	isObject,
	isSummary,
	openQuestions,
	type SessionState,
	type SessionSummary,
} from "../index.ts";

/** What `session.live` said about a session, which is the bridge's word, not the daemon's. */
export interface LiveSession {
	pid: number;
	startedAt: number;
	cwd: string;
	name?: string;
	kind: "terminal" | "background";
}

export interface ListedSession {
	machine: string;
	session: string;
	epoch: string;
	/** Whether its bridge is connected now. A lost bridge reconnects, so the session stays listed. */
	connected: boolean;
	/** Why it ended, once its bridge said so. */
	gone?: string;
	live: LiveSession;
	/** What a client draws before the replay, when the daemon holds one. */
	summary?: SessionSummary;
	state: SessionState;
}

/**
 * Asks the daemon for its sessions. A row that does not decode is dropped rather than drawn half
 * way: the list is a menu, and a menu entry that opens nothing is worse than one that is missing.
 */
export async function listSessions(
	base: string,
	speaks: typeof fetch = fetch,
	options: { signal?: AbortSignal } = {},
): Promise<ListedSession[]> {
	const answer = await speaks(new URL("/sessions", base), {
		headers: { accept: "application/json" },
		...(options.signal === undefined ? {} : { signal: options.signal }),
	});
	if (!answer.ok) throw new DaemonAnswer(answer.status, "the session list");
	const body: unknown = await answer.json();
	if (!Array.isArray(body)) throw new DaemonAnswer(200, "a body that is not a list");
	const kept = body.filter(isListed);
	// A list with rows and none of them readable is a shape this client does not know, and an empty
	// screen would say "no session is open", which is the opposite of what happened. One readable row
	// among unreadable ones is delivered alone: a newer daemon may add fields, and a list with one
	// session is better than none.
	if (kept.length === 0 && body.length > 0) {
		throw new DaemonAnswer(200, "a list this client cannot read");
	}
	return kept;
}

/** A refusal that keeps the code, so a screen can say "not logged in" without matching text. */
export class DaemonAnswer extends Error {
	readonly status: number;

	constructor(status: number, what: string) {
		super(`the daemon answered ${status} for ${what}`);
		this.name = "DaemonAnswer";
		this.status = status;
	}
}

function isListed(value: unknown): value is ListedSession {
	if (!isObject(value)) return false;
	const live = value.live;
	return (
		typeof value.machine === "string" &&
		typeof value.session === "string" &&
		typeof value.epoch === "string" &&
		typeof value.connected === "boolean" &&
		isObject(live) &&
		typeof live.pid === "number" &&
		typeof live.startedAt === "number" &&
		typeof live.cwd === "string" &&
		(live.kind === "terminal" || live.kind === "background") &&
		// The state is typed with both collections, so a row that omits one is not this shape.
		isObject(value.state) &&
		isObject(value.state.questions) &&
		isObject(value.state.permissions) &&
		isObject((value.state.permissions as Record<string, unknown>).rulings) &&
		// The summary is the shape the rest of the package draws from, so it is the protocol's call.
		(value.summary === undefined || isSummary(value.summary))
	);
}

/**
 * How a session reads in one word: gone, reconnecting, or pi's own status word, from the state the
 * daemon folded and then from the summary. A session that has not said one yet reads as nothing.
 */
export function stateOf(session: ListedSession): string {
	if (session.gone !== undefined) return session.gone;
	if (!session.connected) return "reconnecting";
	return session.state.status ?? session.summary?.status ?? "";
}

/**
 * Whether this session is waiting on the person looking. The signal is a question nobody answered:
 * the permission mode says how a session will behave when it edits, not that it is stuck now.
 */
export function wantsYou(session: ListedSession): boolean {
	const state = stateOf(session);
	return state === "blocked" || state === "error" || openQuestions(session.state).length > 0;
}

/** The ones that need you, then the running ones, then what ended. Ties broken by identity. */
export function inOrder(sessions: readonly ListedSession[]): ListedSession[] {
	const rank = (session: ListedSession): number => {
		if (wantsYou(session)) return 0;
		if (session.gone !== undefined) return 2;
		return 1;
	};
	return [...sessions].sort((left, right) => {
		const byRank = rank(left) - rank(right);
		if (byRank !== 0) return byRank;
		// Two sessions with the same title are still two rows, and the list must not dance between
		// refreshes because the daemon answered in another order.
		return `${left.machine}/${left.session}`.localeCompare(`${right.machine}/${right.session}`);
	});
}

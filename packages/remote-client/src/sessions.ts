// The daemon's list of sessions, as a client reads it. One request, one shape, and no React: the
// screen that draws it decides what to show, and the app can be read by anything that speaks fetch.
import {
	isObject,
	isSnapshot,
	openAsks,
	type SessionFacts,
	type SessionSnapshot,
} from "@adeildo/pi-remote-protocol";

/** What `session.live` said about a session, which is the bridge's word, not the daemon's. */
export interface LiveSession {
	pid: number;
	startedAt: number;
	cwd: string;
	name?: string;
	kind: "terminal" | "background";
}

/** One session, as the daemon lists it. */
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
	snapshot?: SessionSnapshot;
	facts: SessionFacts;
}

/**
 * Asks the daemon for its sessions. A row that does not decode is dropped rather than drawn half
 * way: the list is a menu, and a menu entry that opens nothing is worse than one that is missing.
 */
export async function listSessions(
	base: string,
	speaks: typeof fetch = fetch,
): Promise<ListedSession[]> {
	const answer = await speaks(new URL("/sessions", base), {
		headers: { accept: "application/json" },
	});
	if (!answer.ok) throw new DaemonAnswer(answer.status, "the session list");
	const body: unknown = await answer.json();
	if (!Array.isArray(body)) throw new DaemonAnswer(200, "a body that is not a list");
	return body.filter(isListed);
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
		isObject(value.facts) &&
		// The snapshot is the shape the rest of the package draws from, so it is the protocol's call.
		(value.snapshot === undefined || isSnapshot(value.snapshot))
	);
}

/** How a session reads in one word: where it is, and whether anyone is watching. */
export function stateOf(session: ListedSession): string {
	if (session.gone !== undefined) return session.gone;
	if (!session.connected) return "reconnecting";
	return session.snapshot?.state ?? (session.live.kind === "background" ? "idle" : "working");
}

/**
 * Whether this session is waiting on the person looking. The signal is a question nobody answered:
 * the permission mode says how a session will behave when it edits, not that it is stuck now.
 */
export function wantsYou(session: ListedSession): boolean {
	const state = stateOf(session);
	if (state === "blocked" || state === "error") return true;
	// A daemon that lists a session before it reduced a log sends no `asks`; that is "nobody asked",
	// not a reason to throw inside a render.
	const asks = (session.facts as Partial<SessionFacts>).asks;
	return isObject(asks) && openAsks({ rulings: {}, asks: session.facts.asks }).length > 0;
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

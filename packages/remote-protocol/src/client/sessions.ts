// The daemon's list of sessions, as a client reads it.
import {
	isObject,
	isSummary,
	openQuestions,
	type SessionState,
	type SessionSummary,
} from "../index.ts";

/** The bridge's word, not the daemon's. */
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
	/** A lost bridge reconnects, so the session stays listed. */
	connected: boolean;
	gone?: string;
	live: LiveSession;
	summary?: SessionSummary;
	state: SessionState;
}

/** A row that does not decode is dropped: a menu entry that opens nothing is worse than none. */
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
	// Rows that all fail to decode are an unknown shape, not an empty list.
	if (kept.length === 0 && body.length > 0) {
		throw new DaemonAnswer(200, "a list this client cannot read");
	}
	return kept;
}

/** Keeps the code, so a screen can say "not logged in" without matching text. */
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
		isObject(value.state) &&
		isObject(value.state.questions) &&
		isObject(value.state.permissions) &&
		isObject((value.state.permissions as Record<string, unknown>).rulings) &&
		(value.summary === undefined || isSummary(value.summary))
	);
}

export function stateOf(session: ListedSession): string {
	if (session.gone !== undefined) return session.gone;
	if (!session.connected) return "reconnecting";
	return session.state.status ?? session.summary?.status ?? "";
}

export function wantsYou(session: ListedSession): boolean {
	const state = stateOf(session);
	return state === "blocked" || state === "error" || openQuestions(session.state).length > 0;
}

export function inOrder(sessions: readonly ListedSession[]): ListedSession[] {
	const rank = (session: ListedSession): number => {
		if (wantsYou(session)) return 0;
		if (session.gone !== undefined) return 2;
		return 1;
	};
	return [...sessions].sort((left, right) => {
		const byRank = rank(left) - rank(right);
		if (byRank !== 0) return byRank;
		// The list must not reorder between refreshes when the daemon answers in another order.
		return `${left.machine}/${left.session}`.localeCompare(`${right.machine}/${right.session}`);
	});
}

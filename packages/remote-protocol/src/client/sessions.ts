// The daemon's list of sessions, as a client reads it.
import {
	isObject,
	isSummary,
	openQuestions,
	type SessionState,
	type SessionSummary,
} from "../index.ts";
import { ask } from "./ask.ts";

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
export function listSessions(
	base: string,
	speaks: typeof fetch = fetch,
	options: { signal?: AbortSignal } = {},
): Promise<ListedSession[]> {
	return ask(base, "/sessions", { what: "the session list", decode: listedOf, ...options }, speaks);
}

/** Rows that all fail to decode are an unknown shape, not an empty list. */
function listedOf(body: unknown): ListedSession[] | undefined {
	if (!Array.isArray(body)) return undefined;
	const kept = body.filter(isListed);
	return kept.length === 0 && body.length > 0 ? undefined : kept;
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

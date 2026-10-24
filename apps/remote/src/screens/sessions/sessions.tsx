import type { ListedSession } from "@adeildo/pi-remote-client";
// The list of sessions: every session the daemon knows, the ones that need you first. It draws what
// `listSessions` returns, so it has no connection of its own and can be tested without a daemon.
import { type ReactNode, createElement as h } from "react";

export interface SessionsScreenProps {
	sessions: readonly ListedSession[];
}

/** How a session reads in one word: where it is, and whether anyone is watching. */
export function stateOf(session: ListedSession): string {
	if (session.gone !== undefined) return session.gone;
	if (!session.connected) return "reconnecting";
	return session.snapshot?.state ?? (session.live.kind === "background" ? "idle" : "working");
}

/** Whether this session is waiting on the person looking: a question, a blocked run, or a stop. */
export function wantsYou(session: ListedSession): boolean {
	const state = stateOf(session);
	return state === "blocked" || state === "error" || session.snapshot?.mode === "manual";
}

/** What the row calls the session: the title first, then the handle, then the id it was given. */
export function nameOf(session: ListedSession): string {
	const snapshot = session.snapshot;
	return (
		snapshot?.name ?? snapshot?.handle ?? session.live.name ?? `new-${session.session.slice(-4)}`
	);
}

/** The ones that need you, then the running ones, then what ended. */
export function inOrder(sessions: readonly ListedSession[]): ListedSession[] {
	const rank = (session: ListedSession): number => {
		if (wantsYou(session)) return 0;
		if (session.gone !== undefined) return 2;
		return 1;
	};
	return [...sessions].sort((left, right) => {
		const byRank = rank(left) - rank(right);
		return byRank === 0 ? nameOf(left).localeCompare(nameOf(right)) : byRank;
	});
}

export function SessionsScreen({ sessions }: SessionsScreenProps): ReactNode {
	if (sessions.length === 0) {
		return h("main", { className: "remote-sessions" }, h("p", undefined, "No session is open."));
	}
	return h(
		"main",
		{ className: "remote-sessions" },
		h(
			"ul",
			undefined,
			...inOrder(sessions).map((session) =>
				h(
					"li",
					{
						key: `${session.machine}/${session.session}`,
						className: `remote-session-row${wantsYou(session) ? " remote-session-waits" : ""}`,
					},
					h("span", { className: "remote-session-name" }, nameOf(session)),
					h("span", { className: "remote-session-machine" }, session.machine),
					h("span", { className: "remote-session-state" }, stateOf(session)),
					h("span", { className: "remote-session-cost" }, costOf(session)),
				),
			),
		),
	);
}

/** What the session has cost, when the snapshot says; the daemon does not always know. */
function costOf(session: ListedSession): string {
	const cost = session.snapshot?.cost?.total;
	return cost === undefined ? "" : `$${cost.toFixed(2)}`;
}

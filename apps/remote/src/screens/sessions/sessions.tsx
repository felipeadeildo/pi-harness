import { inOrder, type ListedSession, stateOf, wantsYou } from "@adeildo/pi-remote-client";
// The list of sessions: every session the daemon knows, the ones that need you first. It draws what
// `listSessions` returns, so it has no connection of its own and can be tested without a daemon.
import { type ReactNode, createElement as h } from "react";

export interface SessionsScreenProps {
	sessions: readonly ListedSession[];
}

/** What the row calls the session: the title first, then the handle, then the id it was given. */
export function nameOf(session: ListedSession): string {
	const snapshot = session.snapshot;
	return (
		snapshot?.name ?? snapshot?.handle ?? session.live.name ?? `new-${session.session.slice(-4)}`
	);
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

import type { ListedSession } from "@adeildo/pi-remote-protocol/client";
import { inOrder, stateOf, wantsYou } from "@adeildo/pi-remote-protocol/client";

// What the list of sessions says, worked out apart from how it is drawn: the rows are plain data, so
// a test reads them without a browser or a native host, and the screen has one shape to draw.

/** One line of the list, ready to draw and to read in a test. */
export interface Row {
	/** The session itself, which is what the link needs to build its address. */
	listed: ListedSession;
	machine: string;
	session: string;
	/** The name the row shows: the title, then the handle, then the id it was given. */
	name: string;
	/** Where it runs, which tells two sessions with the same name apart. */
	where: string;
	/** How it is doing, in words: working, blocked, done, error, idle. */
	doing: string;
	/** What it has cost, when the daemon says; empty otherwise. */
	cost: string;
	/** Whether this one is waiting on the person, which the row marks. */
	waits: boolean;
}

/** What the row calls the session: the title first, then the handle, then the id it was given. */
export function nameOf(session: ListedSession): string {
	const snapshot = session.snapshot;
	return (
		snapshot?.name ?? snapshot?.handle ?? session.live.name ?? `new-${session.session.slice(-4)}`
	);
}

/** What a row is called across refreshes: the address of the session, which never changes. */
export function keyOf(session: ListedSession): string {
	return `${session.machine}/${session.session}`;
}

/**
 * The list as lines. The order is the one the screen kept when it was mounted, so a session that starts
 * waiting does not jump under the thumb reaching for another one; only a list drawn for the first time
 * sorts itself, and that is the one the person expects to see ordered.
 */
export function rowsOf(sessions: readonly ListedSession[], kept?: readonly string[]): Row[] {
	return ordered(sessions, kept).map((session) => ({
		listed: session,
		machine: session.machine,
		session: session.session,
		name: nameOf(session),
		where: session.machine,
		doing: stateOf(session),
		cost: costOf(session),
		waits: wantsYou(session),
	}));
}

/**
 * The sessions in the order the screen kept, with anything new appended where the list would put it. A
 * refresh never moves a row the person is already looking at: what changes is the mark, not the place.
 */
function ordered(sessions: readonly ListedSession[], kept?: readonly string[]): ListedSession[] {
	if (kept === undefined) return inOrder(sessions);
	const place = (session: ListedSession): number => {
		const at = kept.indexOf(keyOf(session));
		return at === -1 ? kept.length : at;
	};
	return [...inOrder(sessions)].sort((left, right) => place(left) - place(right));
}

/** What the session has cost, as the state says; before the first turn ends, nothing. */
function costOf(session: ListedSession): string {
	const cost = session.state?.cost?.total;
	return cost === undefined ? "" : `$${cost.toFixed(2)}`;
}

// What the list of sessions says, worked out apart from how it is drawn: the rows are plain data, so
// a test reads them without a browser or a native host, and the screen has one shape to draw.
import type { ListedSession } from "@adeildo/pi-remote-client";
import { inOrder, stateOf, wantsYou } from "@adeildo/pi-remote-client";

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

/** The list as lines, ordered so the ones that need you come first. */
export function rowsOf(sessions: readonly ListedSession[]): Row[] {
	return inOrder(sessions).map((session) => ({
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

/** What the session has cost, when the snapshot says; the daemon does not always know. */
function costOf(session: ListedSession): string {
	const cost = session.snapshot?.cost?.total;
	return cost === undefined ? "" : `$${cost.toFixed(2)}`;
}

/**
 * The row's own style, as one object and never an array. A row that sits inside `Link asChild` reaches
 * the document through a Slot that spreads props, and an array spread there becomes `{0: …}` which the
 * browser refuses to apply — the page threw before drawing a single row because of exactly that.
 */
export function rowStyle(marked: boolean): Record<string, number | string> {
	return marked
		? {
				paddingVertical: 12,
				paddingHorizontal: 8,
				borderRadius: 8,
				borderLeftWidth: 3,
				borderLeftColor: "#d97706",
			}
		: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 };
}

// What the list of sessions says, worked out apart from how it is drawn: the rows are plain data, so
// a test reads them without a browser, and the screen has one shape to draw.
import type { ListedSession } from "@adeildo/pi-remote-protocol/client";
import { inOrder, stateOf, wantsYou } from "@adeildo/pi-remote-protocol/client";

/** The mark before a row, the terminal's own: filled while it works, hollow while not, a flag when it waits. */
export type Mark = "working" | "idle" | "waits";

/** One line of the list, ready to draw and to read in a test. */
export interface Row {
	machine: string;
	session: string;
	/** The name the row shows: the name it was given, then its handle, then the end of its id. */
	name: string;
	/** The folder it works in, by its last part, which tells two sessions apart at a glance. */
	folder: string;
	/** How it is doing, in pi's words, or "waits on you"; empty when it has not said. */
	doing: string;
	/** The model it answers with, by its id. */
	model: string;
	/** What it has cost, when the daemon says; empty otherwise. */
	cost: string;
	mark: Mark;
	/** The name of the color the room gave it, which the screen resolves in its scheme. */
	color?: string;
}

/** The rows of one machine, under its name. */
export interface Group {
	machine: string;
	rows: Row[];
}

/** What the row calls the session: the name it was given, then its handle, then the end of its id. */
export function nameOf(session: ListedSession): string {
	const summary = session.summary;
	return (
		summary?.name ?? summary?.handle ?? session.live.name ?? `new-${session.session.slice(-4)}`
	);
}

/** What a row is called across refreshes: the address of the session, which never changes. */
export function keyOf(session: ListedSession): string {
	return `${session.machine}/${session.session}`;
}

/** Keeps the order the screen mounted with, so a row never jumps under the thumb. */
export function rowsOf(sessions: readonly ListedSession[], kept?: readonly string[]): Row[] {
	return ordered(sessions, kept).map((session) => {
		const waits = wantsYou(session);
		const doing = stateOf(session);
		const color = session.state.theme?.color;
		return {
			machine: session.machine,
			session: session.session,
			name: nameOf(session),
			folder: folderOf(session.summary?.cwd ?? session.live.cwd),
			doing: waits ? "waits on you" : doing,
			model: session.state.model?.id ?? "",
			cost: costOf(session),
			mark: markOf(waits, doing),
			...(color === undefined ? {} : { color }),
		};
	});
}

/** The rows under the machine each runs on, the machines in the order their first row comes. */
export function groupsOf(rows: readonly Row[]): Group[] {
	const groups = new Map<string, Row[]>();
	for (const row of rows) groups.set(row.machine, [...(groups.get(row.machine) ?? []), row]);
	return [...groups].map(([machine, grouped]) => ({ machine, rows: grouped }));
}

/** The line over the list: how many are open, on how many machines, and how many wait on you. */
export function countOf(rows: readonly Row[]): string {
	const machines = new Set(rows.map((row) => row.machine)).size;
	const waiting = rows.filter((row) => row.mark === "waits").length;
	const open = `${rows.length} open${machines > 1 ? ` on ${machines} machines` : ""}`;
	return waiting === 0 ? open : `${open}, ${waiting} waiting on you`;
}

function ordered(sessions: readonly ListedSession[], kept?: readonly string[]): ListedSession[] {
	if (kept === undefined) return inOrder(sessions);
	const place = (session: ListedSession): number => {
		const at = kept.indexOf(keyOf(session));
		return at === -1 ? kept.length : at;
	};
	return [...inOrder(sessions)].sort((left, right) => place(left) - place(right));
}

function markOf(waits: boolean, doing: string): Mark {
	if (waits) return "waits";
	return doing === "working" ? "working" : "idle";
}

function folderOf(cwd: string): string {
	return cwd.split("/").findLast((part) => part !== "") ?? cwd;
}

/** What the session has cost, as the state says; before the first turn ends, nothing. */
function costOf(session: ListedSession): string {
	const cost = session.state?.cost?.total;
	return cost === undefined ? "" : `$${cost.toFixed(2)}`;
}

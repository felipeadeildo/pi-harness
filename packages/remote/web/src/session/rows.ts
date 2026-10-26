// The list's rows as plain data, so a test reads them without a browser.
import type { ListedSession } from "@adeildo/pi-remote-protocol/client";
import { inOrder, stateOf, wantsYou } from "@adeildo/pi-remote-protocol/client";

/** The terminal's marks: filled while working, hollow while not, a flag when it waits. */
export type Mark = "working" | "idle" | "waits";

export interface Row {
	machine: string;
	session: string;
	/** The given name, then the handle, then the end of the id. */
	name: string;
	/** By its last part. */
	folder: string;
	/** Pi's words, or "waits on you"; empty until it says. */
	doing: string;
	model: string;
	/** Empty until the daemon says. */
	cost: string;
	mark: Mark;
	/** A theme color name. */
	color?: string;
}

export interface Group {
	machine: string;
	rows: Row[];
}

export function nameOf(session: ListedSession): string {
	const summary = session.summary;
	return (
		summary?.name ?? summary?.handle ?? session.live.name ?? `new-${session.session.slice(-4)}`
	);
}

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

export function groupsOf(rows: readonly Row[]): Group[] {
	const groups = new Map<string, Row[]>();
	for (const row of rows) groups.set(row.machine, [...(groups.get(row.machine) ?? []), row]);
	return [...groups].map(([machine, grouped]) => ({ machine, rows: grouped }));
}

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

function costOf(session: ListedSession): string {
	const cost = session.state?.cost?.total;
	return cost === undefined ? "" : `$${cost.toFixed(2)}`;
}

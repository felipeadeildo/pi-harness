// The list's rows as plain data, so a test reads them without a browser.
import type { SessionActivity } from "@adeildo/pi-remote-protocol";
import { openQuestions } from "@adeildo/pi-remote-protocol";
import { inOrder, type ListedSession, stateOf, wantsYou } from "@adeildo/pi-remote-protocol/client";

import { contextShare, folderOf, money, shortPath } from "./format.ts";

/** The terminal's marks, plus a session that closed. */
export type Mark = "working" | "idle" | "waits" | "error" | "closed";

export interface Row {
	machine: string;
	session: string;
	/** The given name, then the handle, then the end of the id. */
	name: string;
	path: string;
	folder: string;
	branch?: string;
	model: string;
	/** Empty until the daemon says. */
	cost: string;
	/** 0 to 1. */
	context?: number;
	mark: Mark;
	/** What the mark means, in words: "waits on you", "working", "done", "closed". */
	word: string;
	activity?: SessionActivity;
	/** The first line of the agent's last answer. */
	said?: string;
	/** The question it asks, while it waits on one. */
	asks?: string;
	/** When it last did something, on the writer's clock. */
	at?: number;
	/** A theme color name. */
	color?: string;
}

export interface Group {
	id: "you" | "working" | "idle" | "closed";
	title: string;
	rows: Row[];
}

const GROUPS: readonly Omit<Group, "rows">[] = [
	{ id: "you", title: "Needs you" },
	{ id: "working", title: "Working" },
	{ id: "idle", title: "Idle" },
	{ id: "closed", title: "Closed" },
];

export function nameOf(session: ListedSession): string {
	const summary = session.summary;
	return (
		session.state.name ??
		summary?.name ??
		summary?.handle ??
		session.live.name ??
		`new-${session.session.slice(-4)}`
	);
}

export function keyOf(session: ListedSession): string {
	return `${session.machine}/${session.session}`;
}

/** Keeps the order the screen mounted with, so a row never jumps under the thumb. */
export function rowsOf(sessions: readonly ListedSession[], kept?: readonly string[]): Row[] {
	return ordered(sessions, kept).map((session) => {
		const { state } = session;
		const cwd = session.summary?.cwd ?? session.live.cwd;
		const mark = markOf(session);
		const asks = openQuestions(state)[0]?.questions[0];
		const context = contextShare(session.summary?.context);
		const at = Math.max(state.activity?.since ?? 0, state.said?.at ?? 0);
		const color = state.theme?.color;
		return {
			machine: session.machine,
			session: session.session,
			name: nameOf(session),
			path: shortPath(cwd),
			folder: folderOf(cwd),
			model: state.model?.id ?? "",
			cost: money(state.cost?.total),
			mark,
			word: wordOf(session, mark),
			...(state.branch === undefined ? {} : { branch: state.branch }),
			...(context === undefined ? {} : { context }),
			...(state.activity === undefined ? {} : { activity: state.activity }),
			...(state.said === undefined ? {} : { said: state.said.text }),
			...(asks === undefined ? {} : { asks: asks.question }),
			...(at === 0 ? {} : { at }),
			...(color === undefined ? {} : { color }),
		};
	});
}

export function groupsOf(rows: readonly Row[]): Group[] {
	return GROUPS.map((group) => ({
		...group,
		rows: rows.filter((row) => groupOf(row.mark) === group.id),
	})).filter((group) => group.rows.length > 0);
}

export function countOf(rows: readonly Row[]): string {
	const open = rows.filter((row) => row.mark !== "closed").length;
	const machines = new Set(rows.map((row) => row.machine)).size;
	const waiting = rows.filter((row) => row.mark === "waits" || row.mark === "error").length;
	const where = machines > 1 ? ` on ${machines} machines` : "";
	const sessions = `${open} open${where}`;
	return waiting === 0 ? sessions : `${sessions}, ${waiting} need${waiting === 1 ? "s" : ""} you`;
}

export function matchRows(rows: readonly Row[], query: string): Row[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [...rows];
	return rows.filter((row) => {
		const text = [row.name, row.path, row.branch, row.machine, row.model, row.said]
			.join(" ")
			.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}

function groupOf(mark: Mark): Group["id"] {
	switch (mark) {
		case "waits":
		case "error":
			return "you";
		case "working":
			return "working";
		case "idle":
			return "idle";
		case "closed":
			return "closed";
	}
}

function markOf(session: ListedSession): Mark {
	if (session.gone !== undefined) return "closed";
	const state = stateOf(session);
	if (state === "error") return "error";
	if (wantsYou(session)) return "waits";
	return state === "working" ? "working" : "idle";
}

function wordOf(session: ListedSession, mark: Mark): string {
	if (mark === "closed") return "closed";
	if (mark === "waits") return "waits on you";
	const state = stateOf(session);
	return state === "" ? "idle" : state;
}

function ordered(sessions: readonly ListedSession[], kept?: readonly string[]): ListedSession[] {
	if (kept === undefined) return inOrder(sessions);
	const place = (session: ListedSession): number => {
		const at = kept.indexOf(keyOf(session));
		return at === -1 ? kept.length : at;
	};
	return [...inOrder(sessions)].sort((left, right) => place(left) - place(right));
}

// What a client draws before the live stream reaches it: the session's tail, the entry it stopped at,
// and the live state the daemon adds. A shape only grows, so every field past the cursor is optional.

import { isBy, isObject, type By } from "./by.ts";
import type { PermissionMode, SessionTasks } from "./facts.ts";

export interface SessionSnapshot {
	/** pi's session id. */
	session: string;
	machine: string;
	cwd: string;
	/** The session's title: the word `/name` sets, and what the tasks feature writes. */
	name?: string;
	/** The handle the room shows, which is what others mention the session by. */
	handle?: string;
	/** The entry the branch ends at, which is the cursor older history pages back from. */
	leaf?: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	context?: { tokens: number; window?: number };
	kind: "terminal" | "background";
	state?: "working" | "blocked" | "done" | "error" | "idle";
	tasks?: SessionTasks;
	mode?: PermissionMode;
	/** What waits to be sent, as the inbox holds it. */
	queue?: QueuedLetter[];
	/** The questions nobody answered yet, by id. */
	openAsks?: string[];
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	/**
	 * Who has the session open: the one with the latest input, and everyone watching it. They come
	 * from the connection, not from the session, so they are replaced by `presence.changed` and never
	 * reduced from a replay.
	 */
	active?: By;
	viewers?: Viewer[];
}

/** One client watching a session: enough to tell two people apart, and nothing else. */
export interface Viewer {
	name: string;
	machine: string;
}

/** The event that carries a `Presence`. It is of the moment and never kept in the log. */
export const PRESENCE = "presence.changed";

/** The event a session's terminal sends when someone types there, with the terminal's `by`. */
export const PRESENCE_HERE = "presence.here";

/** What a client is told when someone opens a session, closes it, or takes the latest input. */
export interface Presence {
	viewers: Viewer[];
	/** The one whose input came last, which is the one the session answers. */
	active?: By;
}

/**
 * Whether a presence this version reads. A viewer with no name or no machine would be a person
 * nobody can tell from another, so it is not one.
 */
export function isPresence(value: unknown): value is Presence {
	return (
		isObject(value) &&
		Array.isArray(value.viewers) &&
		value.viewers.every(
			(one) => isObject(one) && typeof one.name === "string" && typeof one.machine === "string",
		) &&
		(value.active === undefined || isBy(value.active))
	);
}

/** Whether a value is a snapshot this version reads. */
export function isSnapshot(value: unknown): value is SessionSnapshot {
	return (
		isObject(value) &&
		typeof value.session === "string" &&
		typeof value.machine === "string" &&
		typeof value.cwd === "string" &&
		(value.kind === "terminal" || value.kind === "background") &&
		(value.name === undefined || typeof value.name === "string") &&
		(value.leaf === undefined || typeof value.leaf === "string") &&
		(value.tasks === undefined || isObject(value.tasks)) &&
		(value.queue === undefined || (Array.isArray(value.queue) && value.queue.every(isQueued))) &&
		(value.active === undefined || isBy(value.active)) &&
		(value.viewers === undefined || isPresence({ viewers: value.viewers }))
	);
}

/** Where a command came from, so the terminal can show it as such and the log can say who asked. */
export interface CommandBy {
	by?: By;
}

/** Whether a command carries the cause it must. */
export function isCommandBy(value: unknown): value is CommandBy {
	return isObject(value) && (value.by === undefined || isBy(value.by));
}

/** Why a letter waits, when it waits for more than the run to settle. Absent is the ordinary case. */
export type WaitingWhy = "asleep" | "quiet" | "full" | "stopped";

/** What a message becomes on the way into a session: `steer` goes in between the agent's calls. */
export type WaitingWant = "steer" | "followUp";

/**
 * A letter waiting in the inbox, as the snapshot shows it. `when` is the writer's clock, taken from
 * the letter's `at`, and it is required here because the queue orders and ages by it: a letter the
 * kit allows without `at` gets one from the inbox before it reaches a client.
 */
export interface QueuedLetter {
	id: string;
	by: By;
	text: string;
	want: WaitingWant;
	when: number;
	why?: WaitingWhy;
}

const WHY: readonly WaitingWhy[] = ["asleep", "quiet", "full", "stopped"];

export function isQueued(value: unknown): value is QueuedLetter {
	if (!isObject(value)) return false;
	return (
		typeof value.id === "string" &&
		value.id !== "" &&
		isBy(value.by) &&
		typeof value.text === "string" &&
		value.text !== "" &&
		(value.want === "steer" || value.want === "followUp") &&
		typeof value.when === "number" &&
		Number.isFinite(value.when) &&
		(value.why === undefined || WHY.some((why) => why === value.why))
	);
}

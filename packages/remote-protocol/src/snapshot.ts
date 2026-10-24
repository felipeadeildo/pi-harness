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
	/** The client that has the session open, and who else is watching it. */
	active?: string;
	viewers?: { name: string; machine: string }[];
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
		(value.queue === undefined || (Array.isArray(value.queue) && value.queue.every(isQueued)))
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
 * A letter waiting in the inbox, as the snapshot shows it. `when` is the writer's clock, and it is
 * what the queue orders by and ages by; `by` is what puts the operator's words ahead of an agent's.
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
		(value.want === "steer" || value.want === "followUp") &&
		typeof value.when === "number" &&
		(value.why === undefined || WHY.some((why) => why === value.why))
	);
}

// What a client draws before the live stream reaches it: the session's tail, the entry it stopped at,
// and the live state the daemon adds. A shape only grows, so every field past the cursor is optional.

import { isBy, isObject, type By } from "./by.ts";
import type { PermissionMode, SessionTasks } from "./facts.ts";

export interface SessionSnapshot {
	/** pi's session id. */
	session: string;
	machine: string;
	cwd: string;
	/** The handle others mention it by. */
	name?: string;
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
	queue?: { id: string; text: string; when: number; why?: string }[];
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
		(value.queue === undefined || Array.isArray(value.queue))
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

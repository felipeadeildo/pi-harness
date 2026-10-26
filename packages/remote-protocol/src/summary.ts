// Shapes only grow, so fields past the cursor are optional.

import { isBy, isObject, type By } from "./by.ts";
import type { SessionState } from "./reduce/state.ts";

export interface SessionSummary {
	session: string;
	machine: string;
	cwd: string;
	name?: string;
	handle?: string;
	leaf?: string;
	context?: { tokens: number; window?: number };
	kind: "terminal" | "background";
	status?: "working" | "blocked" | "done" | "error" | "idle";
	/** From the connection, so a replay never sets it. */
	active?: By;
	viewers?: Viewer[];
	state?: SessionState;
}

export interface Viewer {
	name: string;
	machine: string;
}

export const PRESENCE = "presence.changed";

export const PRESENCE_HERE = "presence.here";

export interface Presence {
	viewers: Viewer[];
	active?: By;
}

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

export function isSummary(value: unknown): value is SessionSummary {
	return (
		isObject(value) &&
		typeof value.session === "string" &&
		typeof value.machine === "string" &&
		typeof value.cwd === "string" &&
		(value.kind === "terminal" || value.kind === "background") &&
		(value.name === undefined || typeof value.name === "string") &&
		(value.leaf === undefined || typeof value.leaf === "string") &&
		(value.queue === undefined ||
			(Array.isArray(value.queue) && value.queue.every(isQueuedMessage))) &&
		(value.active === undefined || isBy(value.active)) &&
		(value.viewers === undefined || isPresence({ viewers: value.viewers }))
	);
}

export interface CommandBy {
	by?: By;
}

export function isCommandBy(value: unknown): value is CommandBy {
	return isObject(value) && (value.by === undefined || isBy(value.by));
}

type WaitingWhy = "asleep" | "quiet" | "full" | "stopped" | "not-started";

type WaitingWant = "steer" | "followUp";

/** `when` is the writer's clock. */
export interface QueuedMessage {
	id: string;
	by: By;
	text: string;
	want: WaitingWant;
	when: number;
	why?: WaitingWhy;
}

const WHY: readonly WaitingWhy[] = ["asleep", "quiet", "full", "stopped", "not-started"];

export function isQueuedMessage(value: unknown): value is QueuedMessage {
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

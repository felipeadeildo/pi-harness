// Entries of the removed tasks feature: their model calls still count toward cost, and their handle
// names old sessions.
import { isObject } from "./decode.ts";

/** Each change the tasks wrote, with the list it left and the call that made it. */
const TASKS_UPDATE = "pi-tasks:update";
/** A call of the tasks' model that changed nothing, kept for what it cost. */
const TASKS_USAGE = "pi-tasks:usage";
/** The same two, from the package's first name. */
const GOAL_UPDATE = "pi-goal:update";
const GOAL_USAGE = "pi-goal:usage";

const PAID: ReadonlySet<string> = new Set([TASKS_UPDATE, TASKS_USAGE, GOAL_UPDATE, GOAL_USAGE]);

export interface TasksUsage {
	input: number;
	output: number;
	cost: number;
}

/** What one entry of the tasks cost, or undefined for any other entry. */
export function tasksUsageOf(entry: unknown): TasksUsage | undefined {
	if (!isObject(entry) || entry.type !== "custom" || !isObject(entry.data)) return undefined;
	if (typeof entry.customType !== "string" || !PAID.has(entry.customType)) return undefined;
	const usage = entry.data.usage;
	if (!isObject(usage) || typeof usage.cost !== "number") return undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : 0,
		output: typeof usage.output === "number" ? usage.output : 0,
		cost: usage.cost,
	};
}

/** The handle the tasks last wrote on the branch, or undefined when they never gave one. */
export function tasksHandleOf(branch: readonly unknown[]): string | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (!isObject(entry) || entry.type !== "custom" || entry.customType !== TASKS_UPDATE) continue;
		const state = isObject(entry.data) ? entry.data.state : undefined;
		if (isObject(state) && typeof state.handle === "string") return state.handle;
	}
	return undefined;
}

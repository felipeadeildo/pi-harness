// A branch's timeline is its last update entry.
import { isObject } from "../decode.ts";
import {
	emptyGoal,
	GOAL_VERSION,
	type GoalOp,
	type GoalTrigger,
	type SessionGoal,
} from "./timeline.ts";

export const GOAL_ENTRY = "pi-goal:update";
export const GOAL_USAGE_ENTRY = "pi-goal:usage";

export interface GoalUsage {
	input: number;
	output: number;
	/** In dollars, at the model's catalog price. */
	cost: number;
}

export interface GoalUpdate {
	version: typeof GOAL_VERSION;
	trigger: GoalTrigger;
	ops: GoalOp[];
	/** The first and last entries the model read. */
	covers?: { from?: string; to?: string };
	model?: string;
	usage?: GoalUsage;
	/** What the model proposed and the checks refused, like a done without proof. */
	rejected?: GoalOp[];
	state: SessionGoal;
}

export interface GoalCall {
	trigger: GoalTrigger;
	model: string;
	usage: GoalUsage;
	rejected?: GoalOp[];
}

export function goalFromEntries(entries: readonly unknown[]): SessionGoal {
	for (let index = entries.length - 1; index >= 0; index--) {
		const update = updateOf(entries[index]);
		if (update !== undefined) return update.state;
	}
	return emptyGoal();
}

/** Undefined for any other entry, or an update this version cannot read. */
export function updateOf(entry: unknown): GoalUpdate | undefined {
	if (!isObject(entry) || entry.type !== "custom" || entry.customType !== GOAL_ENTRY)
		return undefined;
	const data = entry.data;
	if (!isObject(data) || data.version !== GOAL_VERSION || !isGoal(data.state)) return undefined;
	return data as unknown as GoalUpdate;
}

export function goalUsageOf(entry: unknown): GoalUsage | undefined {
	if (!isObject(entry) || entry.type !== "custom" || !isObject(entry.data)) return undefined;
	if (entry.customType !== GOAL_ENTRY && entry.customType !== GOAL_USAGE_ENTRY) return undefined;
	const usage = entry.data.usage;
	if (!isObject(usage) || typeof usage.cost !== "number") return undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : 0,
		output: typeof usage.output === "number" ? usage.output : 0,
		cost: usage.cost,
	};
}

export function goalSpent(entries: readonly unknown[]): GoalUsage & { calls: number } {
	const spent = { input: 0, output: 0, cost: 0, calls: 0 };
	for (const entry of entries) {
		const usage = goalUsageOf(entry);
		if (usage === undefined) continue;
		spent.input += usage.input;
		spent.output += usage.output;
		spent.cost += usage.cost;
		spent.calls++;
	}
	return spent;
}

function isGoal(value: unknown): value is SessionGoal {
	return (
		isObject(value) &&
		value.version === GOAL_VERSION &&
		Array.isArray(value.items) &&
		typeof value.nextId === "number"
	);
}

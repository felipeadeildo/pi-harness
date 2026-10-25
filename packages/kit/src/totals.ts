// What a session has spent, summed from what pi records on each message. It lives here because two
// readers want the same number: the terminal's footer and the phone's session list. A copy in each
// would be two owners of one sum, which is how the two of them came to disagree.
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { isObject } from "./decode.ts";
import { tasksUsageOf } from "./tasks/entries.ts";

export interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

export function emptyTotals(): Totals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/** What the model read: the whole prompt, cached or not. */
export function promptOf(totals: Totals): number {
	return totals.input + totals.cacheRead + totals.cacheWrite;
}

export function tokensOf(totals: Totals): number {
	return promptOf(totals) + totals.output;
}

export function usageTotals(usage: UsageLike): Totals {
	const totals = emptyTotals();
	add(totals, usage);
	return totals;
}

/** The branch's total: every message pi recorded, including what a compaction ate. */
export function totalsOf(entries: readonly SessionEntry[]): Totals {
	const totals = emptyTotals();

	for (const entry of entries) {
		if (entry.type === "usage") {
			add(totals, entry.usage);
			continue;
		}
		if (entry.type === "message") {
			// A `message` entry without its message is a shape this version cannot read: a fixture, or a
			// file a version that wrote another one left. It is skipped, not trusted.
			const message: unknown = entry.message;
			if (!isObject(message)) continue;
			const role = message.role;
			const usage: unknown = message.usage;
			if ((role === "assistant" || role === "toolResult") && isUsage(usage)) add(totals, usage);
			continue;
		}
		if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage)
			add(totals, entry.usage);
		else if (entry.type === "custom") addTasks(totals, tasksUsageOf(entry));
	}

	return totals;
}

/** Whether a value is the usage pi records: four token counts and a `cost.total`. */
function isUsage(value: unknown): value is UsageLike {
	return (
		isObject(value) &&
		typeof value.input === "number" &&
		typeof value.output === "number" &&
		typeof value.cacheRead === "number" &&
		typeof value.cacheWrite === "number" &&
		isObject(value.cost) &&
		typeof value.cost.total === "number"
	);
}

function add(totals: Totals, usage: UsageLike): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

// The tasks package's model calls are not pi's, so pi does not count them. They count here.
function addTasks(totals: Totals, usage: ReturnType<typeof tasksUsageOf>): void {
	if (usage === undefined) return;
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cost += usage.cost;
}

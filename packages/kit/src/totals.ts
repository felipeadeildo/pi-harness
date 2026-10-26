// One sum for the terminal's footer and the phone's list, so the two cannot disagree.
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { tasksUsageOf } from "./legacy-tasks.ts";

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

/** Every message pi recorded, including what a compaction ate. */
export function totalsOf(entries: readonly SessionEntry[]): Totals {
	const totals = emptyTotals();

	for (const entry of entries) {
		if (entry.type === "usage") add(totals, entry.usage);
		else if (entry.type === "message" && entry.message.role === "assistant")
			add(totals, entry.message.usage);
		else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage)
			add(totals, entry.message.usage);
		else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage)
			add(totals, entry.usage);
		else if (entry.type === "custom") addTasks(totals, tasksUsageOf(entry));
	}

	return totals;
}

function add(totals: Totals, usage: UsageLike): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

/** Pi does not count the removed tasks' model calls; they count here. */
function addTasks(totals: Totals, usage: ReturnType<typeof tasksUsageOf>): void {
	if (usage === undefined) return;
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cost += usage.cost;
}

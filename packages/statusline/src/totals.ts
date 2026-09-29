// What a session spent, added up from its own entries. Pi keeps the same totals for its footer but
// does not export the helper, so this is the one place that sums them.
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

export function emptyTotals(): Totals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/** The whole branch, not just the messages after the last compaction. */
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
	}

	return totals;
}

/** How much of the prompt came from the cache, the way pi's own footer reports it. */
export function cacheHitPercent(entries: readonly SessionEntry[]): number | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;

		const usage = entry.message.usage;
		const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
		return prompt === 0 ? undefined : (usage.cacheRead / prompt) * 100;
	}
	return undefined;
}

function add(totals: Totals, usage: UsageLike): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

import { type UsageLike } from "@adeildo/pi-kit";

// The sum itself lives in the kit, where the phone's list reads it too: one owner for one number.
export {
	emptyTotals,
	promptOf,
	tokensOf,
	totalsOf,
	type Totals,
	usageTotals,
} from "@adeildo/pi-kit";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface RequestRecord {
	output: number;
	prompt: number;
	firstTokenMs: number;
	generationMs: number;
}

export const REQUEST_CHANGES = "pi-look:request";
/** Written by this package before it was renamed. It has no `prompt`, so it only counts for decode. */
const LEGACY_CHANGES = "pi-statusline:turn";

export interface Averages {
	decode: number | undefined;
	prefill: number | undefined;
}

/** The usage of the last answer the model gave, which is what the cache lines talk about. */
function lastAssistantUsage(entries: readonly SessionEntry[]): UsageLike | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		return entry.message.usage;
	}
	return undefined;
}

export function cacheHitPercent(entries: readonly SessionEntry[]): number | undefined {
	const usage = lastAssistantUsage(entries);
	if (usage === undefined) return undefined;
	const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
	return prompt === 0 ? undefined : (usage.cacheRead / prompt) * 100;
}

export function cacheWarming(entries: readonly SessionEntry[]): boolean {
	const usage = lastAssistantUsage(entries);
	return usage !== undefined && usage.cacheRead === 0 && usage.cacheWrite > 0;
}

export function averagesOf(entries: readonly SessionEntry[]): Averages {
	let output = 0;
	let generationMs = 0;
	let prompt = 0;
	let waitingMs = 0;

	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		if (entry.customType !== REQUEST_CHANGES && entry.customType !== LEGACY_CHANGES) continue;
		const record = entry.data;
		if (!isRecord(record)) continue;

		output += record.output;
		generationMs += record.generationMs;
		if (typeof record.prompt === "number" && record.prompt > 0) {
			prompt += record.prompt;
			waitingMs += record.firstTokenMs;
		}
	}

	return { decode: perSecond(output, generationMs), prefill: perSecond(prompt, waitingMs) };
}

export function perSecond(tokens: number, milliseconds: number): number | undefined {
	return tokens > 0 && milliseconds > 0 ? tokens / (milliseconds / 1000) : undefined;
}

function isRecord(
	data: unknown,
): data is Omit<RequestRecord, "prompt"> & { prompt?: number | undefined } {
	if (typeof data !== "object" || data === null) return false;
	const record = data as Partial<RequestRecord>;
	return (
		typeof record.output === "number" &&
		typeof record.firstTokenMs === "number" &&
		typeof record.generationMs === "number"
	);
}

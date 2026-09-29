import { expect, test } from "bun:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { cacheHitPercent, totalsOf } from "../src/totals.ts";

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

function assistant(input: number, output: number, cacheRead = 0, cost = 0): SessionEntry {
	return {
		type: "message",
		message: { role: "assistant", usage: usage(input, output, cacheRead, 0, cost) },
	} as unknown as SessionEntry;
}

test("an empty session costs nothing", () => {
	expect(totalsOf([])).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
});

test("adds every entry that carries usage, not only the messages", () => {
	const entries = [
		assistant(100, 20, 900, 0.5),
		{ type: "message", message: { role: "toolResult", usage: usage(10, 1, 0, 0, 0.01) } },
		{ type: "usage", usage: usage(1, 1, 0, 0, 0.001) },
		{ type: "compaction", usage: usage(5, 5, 0, 0, 0.002) },
		{ type: "branch_summary", usage: usage(2, 2, 0, 0, 0.001) },
		{ type: "label", label: "nope" },
	] as unknown as SessionEntry[];

	expect(totalsOf(entries)).toEqual({
		input: 118,
		output: 29,
		cacheRead: 900,
		cacheWrite: 0,
		cost: 0.514,
	});
});

test("the cache hit rate comes from the last answer", () => {
	const entries = [assistant(100, 20, 900), assistant(10, 5, 90)] as unknown as SessionEntry[];
	expect(cacheHitPercent(entries)).toBeCloseTo(90, 5);
});

test("a prompt that read nothing from the cache is a zero, the way pi reports it", () => {
	expect(cacheHitPercent([assistant(100, 20)] as unknown as SessionEntry[])).toBe(0);
	expect(cacheHitPercent([] as unknown as SessionEntry[])).toBeUndefined();
});

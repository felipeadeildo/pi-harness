import { describe, expect, test } from "bun:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { emptyGit, parseStatus } from "../../src/look/data/git.ts";
import { Telemetry } from "../../src/look/data/telemetry.ts";
import {
	averagesOf,
	cacheHitPercent,
	REQUEST_ENTRY,
	totalsOf,
	type Totals,
} from "../../src/look/data/totals.ts";

function usage(values: Partial<Totals> = {}) {
	const { cost = 0, ...tokens } = values;
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...tokens, cost: { total: cost } };
}

function clock() {
	let now = 1_000;
	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("telemetry", () => {
	test("measures both directions: prefill over the wait, decode over the writing", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.runStarted();
		telemetry.requestStarted();
		telemetry.answerStarted();

		time.advance(2_000);
		expect(telemetry.request()?.waiting).toBe(true);
		expect(telemetry.request()?.elapsedMs).toBe(2_000);

		telemetry.answerGrew("Hello", usage({ input: 100, cacheRead: 99_900 }));
		time.advance(4_000);
		const record = telemetry.answerEnded(usage({ input: 100, cacheRead: 99_900, output: 800 }));

		expect(record).toEqual({
			output: 800,
			prompt: 100_000,
			firstTokenMs: 2_000,
			generationMs: 4_000,
		});
		const view = telemetry.request();
		expect(view?.streaming).toBe(false);
		expect(view?.prefill).toBe(50_000);
		expect(view?.decode).toBe(200);
		expect(view?.estimated).toBe(false);
	});

	test("estimates the live decode speed until the provider counts the tokens", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.requestStarted();
		time.advance(500);
		telemetry.answerGrew("x".repeat(40), usage());
		time.advance(1_000);
		telemetry.answerGrew("y".repeat(360), usage());

		const view = telemetry.request();
		expect(view?.estimated).toBe(true);
		expect(view?.usage.output).toBe(100);
		expect(view?.decode).toBe(100);
	});

	test("waits for a real sample before it shows a live speed", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.requestStarted();
		telemetry.answerGrew("x", usage());
		time.advance(100);
		expect(telemetry.request()?.decode).toBeUndefined();
	});

	test("counts the requests of a run and freezes its time when it ends", () => {
		const time = clock();
		const telemetry = new Telemetry(time.now);
		telemetry.runStarted();
		telemetry.requestStarted();
		telemetry.requestStarted();
		time.advance(3_000);
		telemetry.runEnded();
		time.advance(60_000);
		expect(telemetry.run()).toEqual({ running: false, elapsedMs: 3_000, requests: 2 });
	});

	test("an answer that never wrote anything leaves no record", () => {
		const telemetry = new Telemetry(clock().now);
		telemetry.requestStarted();
		expect(telemetry.answerEnded(usage({ input: 10 }))).toBeUndefined();
	});
});

describe("git", () => {
	test("reads the distance, the changes and the stash from one status call", () => {
		const output = [
			"# branch.oid 1234",
			"# branch.head main",
			"# branch.upstream origin/main",
			"# branch.ab +2 -22",
			"# stash 1",
			"1 M. N... 100644 100644 100644 aaa bbb staged.ts",
			"1 .M N... 100644 100644 100644 aaa bbb changed.ts",
			"1 MM N... 100644 100644 100644 aaa bbb both.ts",
			"2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts",
			"u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
			"? new-file.ts",
			"? other.ts",
			"",
		].join("\n");

		expect(parseStatus(output)).toEqual({
			ahead: 2,
			behind: 22,
			staged: 3,
			modified: 2,
			untracked: 2,
			conflicted: 1,
			stashed: 1,
		});
	});

	test("a clean tree", () => {
		expect(parseStatus("# branch.head main\n")).toEqual(emptyGit());
	});
});

function assistant(values: Partial<Totals>): SessionEntry {
	return { type: "message", message: { role: "assistant", usage: usage(values) } } as SessionEntry;
}

function custom(customType: string, data: unknown): SessionEntry {
	return { type: "custom", customType, data } as SessionEntry;
}

describe("totals", () => {
	test("adds up the branch", () => {
		const entries = [
			assistant({ input: 10, output: 5, cacheRead: 90, cost: 0.1 }),
			assistant({ input: 20, output: 15, cacheWrite: 30, cost: 0.2 }),
		];
		expect(totalsOf(entries)).toEqual({
			input: 30,
			output: 20,
			cacheRead: 90,
			cacheWrite: 30,
			cost: 0.30000000000000004,
		});
		expect(cacheHitPercent(entries)).toBe(0);
		expect(cacheHitPercent(entries.slice(0, 1))).toBe(90);
	});

	test("averages both speeds, and reads the records this package wrote under its old name", () => {
		const entries = [
			custom(REQUEST_ENTRY, {
				output: 300,
				prompt: 60_000,
				firstTokenMs: 2_000,
				generationMs: 1_000,
			}),
			custom(REQUEST_ENTRY, {
				output: 100,
				prompt: 40_000,
				firstTokenMs: 2_000,
				generationMs: 1_000,
			}),
			custom("pi-statusline:turn", { output: 200, firstTokenMs: 500, generationMs: 2_000 }),
			custom("someone-else", { output: 1e9, firstTokenMs: 1, generationMs: 1 }),
		];
		expect(averagesOf(entries)).toEqual({ decode: 150, prefill: 25_000 });
	});

	test("no records, no speeds", () => {
		expect(averagesOf([])).toEqual({ decode: undefined, prefill: undefined });
	});
});

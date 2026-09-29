import { expect, test } from "bun:test";

import { PRESETS } from "../src/presets.ts";
import {
	count,
	duration,
	emptyData,
	gaugeBar,
	PLAIN,
	renderParts,
	shortenPath,
	type SessionData,
} from "../src/segments.ts";
import { emptyTotals } from "../src/totals.ts";

const options = { pathLength: 40, statuses: true, gauge: true, icons: false };
const icons = { ...options, icons: true };

function data(overrides: Partial<SessionData> = {}): SessionData {
	return {
		...emptyData(),
		cwd: "/home/ada/Projects/pi-harness",
		home: "/home/ada",
		branch: "main",
		host: "ghost",
		sessionName: "harness",
		model: {
			id: "deepseek-chat",
			name: "DeepSeek V4.1 Flash",
			provider: "deepseek",
			reasoning: true,
		},
		thinking: "high",
		context: { percent: 43.1, tokens: 431_000, contextWindow: 1_000_000 },
		totals: {
			input: 2_400_000,
			output: 347_000,
			cacheRead: 83_000_000,
			cacheWrite: 0,
			cost: 13.445,
		},
		cacheHit: 99.9,
		rate: 42.4,
		firstTokenMs: 320,
		statuses: ["auto · anywhere"],
		...overrides,
	};
}

const parts = (
	ids: Parameters<typeof renderParts>[0],
	overrides: Partial<SessionData> = {},
	opts = options,
) => renderParts(ids, data(overrides), opts, PLAIN);

test("the folder takes the short route home and is cut from the left", () => {
	expect(shortenPath("/home/ada/Projects/pi-harness", "/home/ada", 40)).toBe(
		"~/Projects/pi-harness",
	);
	expect(shortenPath("/home/ada/Projects/pi-harness", "/home/ada", 12)).toBe("…/pi-harness");
	expect(shortenPath("/home/ada/Projects/pi-harness", "/home/ada", 0)).toBe(
		"~/Projects/pi-harness",
	);
	expect(shortenPath("/etc/hosts", "/home/ada", 40)).toBe("/etc/hosts");
	expect(shortenPath("/home/ada", "/home/ada", 40)).toBe("~");
});

test("counts read the way pi writes them", () => {
	expect(count(999)).toBe("999");
	expect(count(2400)).toBe("2.4k");
	expect(count(347_000)).toBe("347k");
	expect(count(83_000_000)).toBe("83.0M");
});

test("the gauge fills by tenths", () => {
	expect(gaugeBar(0)).toBe("░░░░░░░░");
	expect(gaugeBar(50)).toBe("▓▓▓▓░░░░");
	expect(gaugeBar(100)).toBe("▓▓▓▓▓▓▓▓");
});

test("a running answer reads as minutes and seconds", () => {
	expect(duration(9_000)).toBe("9s");
	expect(duration(137_000)).toBe("2m 17s");
	expect(duration(3_900_000)).toBe("1h 5m");
});

test("the pieces the reference footer shows, plus the two it lacks", () => {
	expect(parts(["path", "git", "session"])).toEqual(["~/Projects/pi-harness", "main", "harness"]);
	expect(parts(["model", "thinking"])).toEqual(["DeepSeek V4.1 Flash", "high"]);
	expect(parts(["rate", "ttft"])).toEqual(["42 tok/s", "320ms"]);
	expect(parts(["tokens"])).toEqual(["↑2.4M", "↓347k", "R83.0M"]);
	expect(parts(["cache"])).toEqual(["cache 99.9%"]);
	expect(parts(["cost"])).toEqual(["$13.445"]);
	expect(parts(["context"])).toEqual(["43.1% ▓▓▓░░░░░ 431k/1.0M"]);
	expect(parts(["host", "turn"])).toEqual(["ghost", undefined]);
});

test("the gauge and the icons are each optional", () => {
	expect(parts(["context"], {}, { ...options, gauge: false })).toEqual(["43.1% 431k/1.0M"]);
	expect(parts(["rate", "thinking", "host"], {}, icons)).toEqual([
		"⚡ 42 tok/s",
		"✦ high",
		"⌂ ghost",
	]);
});

test("the branch says how far from its upstream it is, and whether anything changed", () => {
	expect(parts(["git"], { git: { ahead: 2, behind: 1, dirty: true } })).toEqual(["main↑2↓1*"]);
	expect(parts(["git"], { git: { ahead: 0, behind: 0, dirty: false } })).toEqual(["main"]);
	expect(parts(["git"], { git: { ahead: 3, behind: 0, dirty: false } })).toEqual(["main↑3"]);
	expect(parts(["git"], {}, icons)).toEqual(["⎇ main"]);
	expect(parts(["git"], { branch: null })).toEqual([undefined]);
});

test("other packages show only when asked for, and the statuses come one per piece", () => {
	expect(parts(["statuses"])).toEqual(["auto · anywhere"]);
	expect(parts(["statuses"], {}, { ...options, statuses: false })).toEqual([undefined]);
	expect(parts(["statuses"], { statuses: ["one", "two"] })).toEqual(["one · two"]);
	expect(parts(["statuses"], { statuses: ["one", "two"] }, icons)).toEqual(["≫ one · two"]);
});

test("a subscription says so, and a session that spent nothing says nothing", () => {
	expect(parts(["cost"], { subscription: true })).toEqual(["$13.445 (sub)"]);
	expect(parts(["cost"], { subscription: true, totals: emptyTotals() })).toEqual([undefined]);
	expect(
		parts(["cost"], {
			subscription: false,
			totals: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 },
		}),
	).toEqual([undefined]);
});

test("an answer that is still running shows the time, not a rate", () => {
	expect(
		parts(["turn"], { turn: { running: true, elapsedMs: 137_000, usage: emptyTotals() } }),
	).toEqual(["2m 17s"]);
	expect(parts(["rate"], { rate: undefined })).toEqual([undefined]);
});

test("every preset only names segments that exist", () => {
	for (const preset of Object.values(PRESETS)) {
		for (const line of preset.lines) {
			for (const group of line) expect(group.segments.length).toBeGreaterThan(0);
		}
		// The model is the last thing to leave, so a line always says who is working.
		expect(preset.cutOrder.at(-1)).toBeDefined();
	}
});

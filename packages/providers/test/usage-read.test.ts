import { expect, test } from "bun:test";

import { noteUsage, resetNote, usageOf, windowsOf, worstWindow } from "../src/usage/read.ts";
import type { AccountUsage, UsageMap } from "../src/usage/types.ts";

test("the note counts down the worst window", () => {
	const usage: AccountUsage = { session: { used: 100, resetsAt: 1_791_069_000 } };
	expect(resetNote(usage, (1_791_069_000 - 684) * 1000)).toBe("resets in 11m");
});

test("a week further along than the session is the worst window", () => {
	const usage: AccountUsage = {
		week: { used: 80, resetsAt: 1_728_000 },
		session: { used: 10, resetsAt: 1_728_000 },
	};
	expect(worstWindow(usage, 0)?.name).toBe("week");
	expect(resetNote(usage, 0)).toBe("resets in 20d");
});

test("a reading is kept per provider and account", () => {
	const map: UsageMap = new Map();
	const reading: AccountUsage = { session: { used: 100 } };
	noteUsage(map, "anthropic", "work", reading);
	expect(usageOf(map, "anthropic", "work")?.session?.used).toBe(100);
	expect(usageOf(map, "anthropic", "other")).toBeUndefined();

	// Nothing read leaves the last reading alone.
	noteUsage(map, "anthropic", "work", undefined);
	expect(usageOf(map, "anthropic", "work")?.session?.used).toBe(100);
});

test("a reading lists every window with its reset", () => {
	const now = 1_000_000_000_000;
	const usage: AccountUsage = {
		session: { used: 62, resetsAt: now / 1000 + 7200 },
		week: { used: 30, resetsAt: now / 1000 + 172_800 },
	};
	expect(windowsOf(usage, now)).toEqual([
		{ name: "5h", used: 62, resetsIn: "2h" },
		{ name: "week", used: 30, resetsIn: "2d" },
	]);
	expect(windowsOf(undefined, now)).toEqual([]);
});

test("a window that already rolled reads as empty", () => {
	const now = 1_000_000_000_000;
	const usage: AccountUsage = { session: { used: 100, resetsAt: now / 1000 - 60 } };
	expect(windowsOf(usage, now)).toEqual([{ name: "5h", used: 0 }]);
	expect(worstWindow(usage, now)?.window.used).toBe(0);
});

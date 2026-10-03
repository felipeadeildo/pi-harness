import { expect, test } from "bun:test";

import { fromHeaders, noteUsage, resetNote, type UsageMap, usageOf } from "../src/usage.ts";

// Copied from a real 429: the plan was at 100% of its five-hour window.
const HEADERS: Record<string, string> = {
	"anthropic-ratelimit-unified-representative-claim": "five_hour",
	"anthropic-ratelimit-unified-7d-reset": "1791399600",
	"anthropic-ratelimit-unified-7d-status": "allowed",
	"retry-after": "684",
	"anthropic-ratelimit-unified-overage-status": "rejected",
	"anthropic-ratelimit-unified-5h-status": "rejected",
	"anthropic-ratelimit-unified-reset": "1791069000",
	"anthropic-ratelimit-unified-5h-utilization": "1.0",
	"anthropic-ratelimit-unified-5h-reset": "1791069000",
	"anthropic-ratelimit-unified-7d-utilization": "0.3",
	"anthropic-ratelimit-unified-status": "rejected",
};

test("a response carries the plan's windows", () => {
	const usage = fromHeaders(HEADERS);
	expect(usage?.session).toEqual({ used: 100, resetsAt: 1791069000 });
	expect(usage?.week).toEqual({ used: 30, resetsAt: 1791399600 });
	expect(usage?.status).toBe("rejected");
	expect(usage?.binding).toBe("five_hour");
});

test("header names are read whatever their case", () => {
	const upper: Record<string, string> = {};
	for (const [name, value] of Object.entries(HEADERS)) upper[name.toUpperCase()] = value;
	expect(fromHeaders(upper)?.session?.used).toBe(100);
});

test("a response without the plan's headers says nothing", () => {
	expect(fromHeaders({ "content-type": "application/json" })).toBeUndefined();
});

test("the note counts down the window the provider says is binding", () => {
	const usage = fromHeaders(HEADERS);
	expect(resetNote(usage, (1791069000 - 684) * 1000)).toBe("resets in 11m");
});

test("a per-model week counts the week, and a window already past says nothing", () => {
	const usage = {
		readAt: 0,
		binding: "seven_day_opus",
		week: { used: 10, resetsAt: 518400 },
		session: { used: 0, resetsAt: 60 },
	};
	expect(resetNote(usage, 0)).toBe("resets in 6d");
	expect(resetNote(usage, 600_000_000)).toBeUndefined();
});

test("a reading is kept per provider and account", () => {
	const map: UsageMap = new Map();
	noteUsage(map, "anthropic", "work", HEADERS);
	expect(usageOf(map, "anthropic", "work")?.session?.used).toBe(100);
	expect(usageOf(map, "anthropic", "other")).toBeUndefined();

	// A response without the headers, like an OpenAI one, leaves the reading alone.
	noteUsage(map, "anthropic", "work", { "content-type": "application/json" });
	expect(usageOf(map, "anthropic", "work")?.session?.used).toBe(100);
});

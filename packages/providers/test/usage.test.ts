import { expect, spyOn, test } from "bun:test";

import {
	type AccountUsage,
	fetchUsage,
	fromEndpoint,
	fromHeaders,
	noteUsage,
	Quota,
	resetNote,
	type UsageMap,
	usageOf,
	usageText,
} from "../src/usage.ts";

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
	const usage: AccountUsage = {
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

// The endpoint's shape, copied from a real answer at 100% of the five-hour window.
const BODY = {
	five_hour: { utilization: 100, resets_at: "2026-10-03T23:09:59.893028+00:00" },
	seven_day: { utilization: 30, resets_at: "2026-10-07T18:59:59.893048+00:00" },
	seven_day_opus: null,
	seven_day_sonnet: null,
	extra_usage: { is_enabled: false, monthly_limit: 18013, used_credits: 0, utilization: 0 },
	limits: [
		{
			kind: "session",
			group: "session",
			percent: 100,
			severity: "critical",
			resets_at: "2026-10-03T23:09:59.893028+00:00",
			is_active: true,
		},
		{
			kind: "weekly_all",
			group: "weekly",
			percent: 30,
			severity: "normal",
			resets_at: "2026-10-07T18:59:59.893048+00:00",
			is_active: false,
		},
	],
};

test("the endpoint's answer becomes the same shape as the headers", () => {
	const usage = fromEndpoint(BODY);
	expect(usage?.session).toEqual({
		used: 100,
		resetsAt: Math.round(Date.parse("2026-10-03T23:09:59.893028+00:00") / 1000),
	});
	expect(usage?.week?.used).toBe(30);
	expect(usage?.binding).toBe("five_hour");
});

test("the older buckets answer when the limits list is gone", () => {
	const usage = fromEndpoint({ five_hour: { utilization: 12, resets_at: "2026-10-03T23:09:59Z" } });
	expect(usage?.session?.used).toBe(12);
	expect(usage?.binding).toBeUndefined();
});

test("the endpoint is asked the way Claude Code asks it", async () => {
	const mock = spyOn(globalThis, "fetch");
	mock.mockResolvedValue(new Response(JSON.stringify(BODY), { status: 200 }));
	try {
		const usage = await fetchUsage({ token: "tok", version: "2.1.280" });
		expect(usage?.session?.used).toBe(100);

		const [url, init] = mock.mock.calls[0] ?? [];
		const headers = init?.headers as Record<string, string>;
		expect(String(url)).toContain("/api/oauth/usage");
		expect(headers["User-Agent"]).toBe("claude-cli/2.1.280 (external, cli)");
		expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
		expect(headers.Authorization).toBe("Bearer tok");
	} finally {
		mock.mockRestore();
	}
});

test("an endpoint that refuses or breaks is no reading, not an error", async () => {
	const mock = spyOn(globalThis, "fetch");
	try {
		mock.mockResolvedValue(new Response("{}", { status: 429 }));
		expect(await fetchUsage({ token: "tok", version: "1.0.0" })).toBeUndefined();
		mock.mockRejectedValue(new Error("fetch failed"));
		expect(await fetchUsage({ token: "tok", version: "1.0.0" })).toBeUndefined();
	} finally {
		mock.mockRestore();
	}
});

const READING: AccountUsage = {
	session: { used: 62, resetsAt: 1791399600 },
};

test("two reads of one account share the request", async () => {
	let calls = 0;
	const quota = new Quota(
		() => "1.0.0",
		async () => {
			calls += 1;
			return READING;
		},
	);
	const [first, second] = await Promise.all([
		quota.ensure("anthropic/work", "t"),
		quota.ensure("anthropic/work", "t"),
	]);
	expect(calls).toBe(1);
	expect(first).toBe(READING);
	expect(second).toBe(READING);
});

test("a failure is not retried right away, and no token asks nothing", async () => {
	let calls = 0;
	const quota = new Quota(
		() => "1.0.0",
		async () => {
			calls += 1;
			return undefined;
		},
	);
	expect(await quota.ensure("anthropic/work", "t")).toBeUndefined();
	expect(await quota.ensure("anthropic/work", "t")).toBeUndefined();
	expect(calls).toBe(1);
	expect(await quota.ensure("anthropic/other", undefined)).toBeUndefined();
	expect(calls).toBe(1);
});

test("a window that rolled over is read again", async () => {
	let calls = 0;
	const rolled: AccountUsage = { session: { used: 100, resetsAt: 1 } };
	const quota = new Quota(
		() => "1.0.0",
		async () => {
			calls += 1;
			return rolled;
		},
	);
	await quota.ensure("anthropic/work", "t");
	await quota.ensure("anthropic/work", "t");
	expect(calls).toBe(2);
});

test("a picker row shows the percent and the time left", () => {
	const now = 1_000_000_000_000;
	const usage: AccountUsage = {
		session: { used: 62, resetsAt: now / 1000 + 7200 },
	};
	expect(usageText(usage, now)).toBe("62% ↓2h");
	expect(usageText(undefined, now)).toBeUndefined();
});

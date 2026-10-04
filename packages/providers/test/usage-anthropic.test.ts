import { expect, spyOn, test } from "bun:test";

import { fetchUsage, fromEndpoint, fromHeaders, probeUsage } from "../src/usage/anthropic.ts";

// Copied from a real 429: the plan was at 100% of its five-hour window.
export const HEADERS: Record<string, string> = {
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
});

test("header names are read whatever their case", () => {
	const upper: Record<string, string> = {};
	for (const [name, value] of Object.entries(HEADERS)) upper[name.toUpperCase()] = value;
	expect(fromHeaders(upper)?.session?.used).toBe(100);
});

test("a response without the plan's headers says nothing", () => {
	expect(fromHeaders({ "content-type": "application/json" })).toBeUndefined();
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
});

test("the older buckets answer when the limits list is gone", () => {
	const usage = fromEndpoint({ five_hour: { utilization: 12, resets_at: "2026-10-03T23:09:59Z" } });
	expect(usage?.session?.used).toBe(12);
});

test("the endpoint is asked the way Claude Code asks it", async () => {
	const mock = spyOn(globalThis, "fetch");
	mock.mockResolvedValue(new Response(JSON.stringify(BODY), { status: 200 }));
	try {
		const usage = await fetchUsage({ token: "tok" }, "2.1.280");
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
		expect(await fetchUsage({ token: "tok" }, "1.0.0")).toBeUndefined();
		mock.mockRejectedValue(new Error("fetch failed"));
		expect(await fetchUsage({ token: "tok" }, "1.0.0")).toBeUndefined();
	} finally {
		mock.mockRestore();
	}
});

test("the one-token call reads the same headers, even on a rejection", async () => {
	const mock = spyOn(globalThis, "fetch");
	mock.mockResolvedValue(
		new Response("{}", {
			status: 429,
			headers: { "anthropic-ratelimit-unified-5h-utilization": "0.5" },
		}),
	);
	try {
		const usage = await probeUsage({ token: "tok" }, "2.1.280");
		expect(usage?.session?.used).toBe(50);

		const [url, init] = mock.mock.calls[0] ?? [];
		expect(String(url)).toContain("/v1/messages");
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body)).max_tokens).toBe(1);
	} finally {
		mock.mockRestore();
	}
});

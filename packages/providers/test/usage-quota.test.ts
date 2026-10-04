import { expect, test } from "bun:test";

import { Quota } from "../src/usage/quota.ts";
import type { AccountUsage, QuotaReader, UsageReader } from "../src/usage/types.ts";

const READING: AccountUsage = { session: { used: 62, resetsAt: 1791399600 } };

function quotaWith(read: UsageReader, probe?: UsageReader): Quota {
	return new Quota({ anthropic: { read, probe } satisfies QuotaReader });
}

test("two reads of one account share the request", async () => {
	let calls = 0;
	const quota = quotaWith(async () => {
		calls += 1;
		return READING;
	});
	const [first, second] = await Promise.all([
		quota.ensure("anthropic", "work", "t"),
		quota.ensure("anthropic", "work", "t"),
	]);
	expect(calls).toBe(1);
	expect(first).toBe(READING);
	expect(second).toBe(READING);
});

test("a failure is not retried right away, and no token asks nothing", async () => {
	let calls = 0;
	const quota = quotaWith(async () => {
		calls += 1;
		return undefined;
	});
	expect(await quota.ensure("anthropic", "work", "t")).toBeUndefined();
	expect(await quota.ensure("anthropic", "work", "t")).toBeUndefined();
	expect(calls).toBe(1);
	expect(await quota.ensure("anthropic", "work", undefined)).toBeUndefined();
	expect(await quota.ensure("openai", "work", "t")).toBeUndefined();
	expect(calls).toBe(1);
});

test("a window that rolled over is read again", async () => {
	let calls = 0;
	const rolled: AccountUsage = { session: { used: 100, resetsAt: 1 } };
	const quota = quotaWith(async () => {
		calls += 1;
		return rolled;
	});
	await quota.ensure("anthropic", "work", "t");
	await quota.ensure("anthropic", "work", "t");
	expect(calls).toBe(2);
});

test("a reader that refuses falls back to its probe", async () => {
	const quota = quotaWith(
		async () => undefined,
		async () => READING,
	);
	expect(await quota.ensure("anthropic", "work", "t")).toBe(READING);
});

test("a reader hands the response headers to the session", () => {
	const quotaWithHeaders = new Quota({
		anthropic: {
			read: async () => undefined,
			headers: () => READING,
		},
	});
	expect(quotaWithHeaders.fromHeaders("anthropic", {})).toBe(READING);
	expect(quotaWithHeaders.fromHeaders("openai", {})).toBeUndefined();
});

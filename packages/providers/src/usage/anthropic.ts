// Anthropic's plan: the unified headers on every response, the usage endpoint, and the one-token call
// for when the endpoint refuses. The endpoint is rate limited per token, so it is asked once.
import { isObject } from "@adeildo/pi-kit";

import type { AccountUsage, QuotaReader, UsageRequest, Window } from "./types.ts";

const PREFIX = "anthropic-ratelimit-unified-";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PROBE_URL = "https://api.anthropic.com/v1/messages";
const PROBE_MODEL = "claude-haiku-4-5";
const OAUTH_BETA = "oauth-2025-04-20";
const TIMEOUT_MS = 15_000;

/** How to read Anthropic's plan, with the Claude Code version the caller reports. */
export function anthropicQuota(version: () => string): QuotaReader {
	return {
		read: (request) => fetchUsage(request, version()),
		probe: (request) => probeUsage(request, version()),
		headers: fromHeaders,
	};
}

export function fromHeaders(headers: Record<string, string>): AccountUsage | undefined {
	const lower: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;

	const session = headerWindow(lower, "5h");
	const week = headerWindow(lower, "7d");
	if (session === undefined && week === undefined) return undefined;
	return {
		...(session === undefined ? {} : { session }),
		...(week === undefined ? {} : { week }),
	};
}

export function fromEndpoint(body: unknown): AccountUsage | undefined {
	if (!isObject(body)) return undefined;

	const limits = Array.isArray(body.limits) ? body.limits.filter(isObject) : [];
	const session = limitWindow(limits, "session") ?? bucketWindow(body.five_hour);
	const week = limitWindow(limits, "weekly_all") ?? bucketWindow(body.seven_day);
	if (session === undefined && week === undefined) return undefined;
	return {
		...(session === undefined ? {} : { session }),
		...(week === undefined ? {} : { week }),
	};
}

/** The endpoint's answer, or undefined when it refuses or the network fails. Never throws. */
export async function fetchUsage(
	request: UsageRequest,
	version: string,
): Promise<AccountUsage | undefined> {
	try {
		const response = await fetch(USAGE_URL, {
			headers: {
				Authorization: `Bearer ${request.token}`,
				"anthropic-beta": OAUTH_BETA,
				"anthropic-version": "2023-06-01",
				Accept: "application/json",
				// The endpoint gives the generous bucket to callers that look like Claude Code.
				"User-Agent": `claude-cli/${version} (external, cli)`,
			},
			signal: usageSignal(request.signal),
		});
		if (!response.ok) return undefined;
		return fromEndpoint(await response.json());
	} catch {
		return undefined;
	}
}

/** The plan's windows from a one-token call, for when the endpoint refuses. Never throws. */
export async function probeUsage(
	request: UsageRequest,
	version: string,
): Promise<AccountUsage | undefined> {
	try {
		const response = await fetch(PROBE_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${request.token}`,
				"anthropic-beta": `claude-code-20250219,${OAUTH_BETA}`,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
				"x-app": "cli",
				"User-Agent": `claude-cli/${version}`,
			},
			body: JSON.stringify({
				model: PROBE_MODEL,
				max_tokens: 1,
				stream: false,
				system: [
					{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
				],
				messages: [{ role: "user", content: "ok" }],
			}),
			signal: usageSignal(request.signal),
		});
		// A rejection carries the windows too, so the status does not matter here.
		return fromHeaders(Object.fromEntries(response.headers));
	} catch {
		return undefined;
	}
}

/** The request signal, cancelled by the caller or by the timeout. */
function usageSignal(signal: AbortSignal | undefined): AbortSignal {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function headerWindow(headers: Record<string, string>, key: string): Window | undefined {
	const used = numberOf(headers[`${PREFIX}${key}-utilization`]);
	if (used === undefined) return undefined;
	// The headers carry a fraction; a percent is what a person reads.
	return percentWindow(used * 100, numberOf(headers[`${PREFIX}${key}-reset`]));
}

function limitWindow(limits: readonly Record<string, unknown>[], kind: string): Window | undefined {
	const entry = limits.find((candidate) => candidate.kind === kind);
	if (entry === undefined) return undefined;
	return percentWindow(numberOf(entry.percent), dateOf(entry.resets_at));
}

function bucketWindow(value: unknown): Window | undefined {
	if (!isObject(value)) return undefined;
	return percentWindow(numberOf(value.utilization), dateOf(value.resets_at));
}

function percentWindow(used: number | undefined, resetsAt: number | undefined): Window | undefined {
	if (used === undefined) return undefined;
	return {
		used: Math.round(Math.max(0, Math.min(100, used)) * 10) / 10,
		...(resetsAt === undefined || resetsAt <= 0 ? {} : { resetsAt: Math.round(resetsAt) }),
	};
}

function numberOf(value: unknown): number | undefined {
	if (value === null || value === undefined) return undefined;
	if (typeof value === "string" && value.trim() === "") return undefined;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function dateOf(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? Math.round(parsed / 1000) : undefined;
}

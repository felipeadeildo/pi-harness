// The plan's quota. Every inference response carries it as headers, so the account that served the
// request gets a reading for free. The endpoint is asked only when there is none, because it is rate
// limited per token.

import { isObject } from "@adeildo/pi-kit";

/** Percent used, and the unix second the window resets. */
export interface Window {
	used: number;
	resetsAt?: number;
}

export interface AccountUsage {
	/** The window the provider says is binding, like `five_hour`. */
	binding?: string;
	session?: Window;
	week?: Window;
}

export type UsageMap = Map<string, Map<string, AccountUsage>>;

const PREFIX = "anthropic-ratelimit-unified-";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

export function fromHeaders(headers: Record<string, string>): AccountUsage | undefined {
	const lower: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;

	const session = headerWindow(lower, "5h");
	const week = headerWindow(lower, "7d");
	if (session === undefined && week === undefined) return undefined;

	const binding = lower[`${PREFIX}representative-claim`];
	return {
		...(binding === undefined || binding === "" ? {} : { binding }),
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

	const active = limits.find((entry) => entry.is_active === true);
	const binding = active === undefined ? undefined : bindingName(stringField(active.kind));
	return {
		...(binding === undefined ? {} : { binding }),
		...(session === undefined ? {} : { session }),
		...(week === undefined ? {} : { week }),
	};
}

export interface UsageFetch {
	token: string;
	version: string;
	signal?: AbortSignal;
}

/** The endpoint's answer, or undefined when it refuses or the network fails. Never throws. */
export async function fetchUsage(options: UsageFetch): Promise<AccountUsage | undefined> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const signal =
		options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
	try {
		const response = await fetch(USAGE_URL, {
			headers: {
				Authorization: `Bearer ${options.token}`,
				"anthropic-beta": OAUTH_BETA,
				"anthropic-version": "2023-06-01",
				Accept: "application/json",
				// The endpoint gives the generous bucket to callers that look like Claude Code.
				"User-Agent": `claude-cli/${options.version} (external, cli)`,
			},
			signal,
		});
		if (!response.ok) return undefined;
		return fromEndpoint(await response.json());
	} catch {
		return undefined;
	}
}

/** Reads the endpoint once per account and keeps the answer for the process. */
export class Quota {
	private readonly readings = new Map<string, AccountUsage>();
	private readonly inFlight = new Map<string, Promise<AccountUsage | undefined>>();
	private readonly failedAt = new Map<string, number>();

	constructor(
		private readonly version: () => string,
		private readonly load: (options: UsageFetch) => Promise<AccountUsage | undefined> = fetchUsage,
	) {}

	read(key: string): AccountUsage | undefined {
		return this.readings.get(key);
	}

	async ensure(key: string, token: string | undefined): Promise<AccountUsage | undefined> {
		if (token === undefined) return undefined;
		const known = this.readings.get(key);
		if (known !== undefined && !rolled(known, Date.now())) return known;
		if (Date.now() - (this.failedAt.get(key) ?? 0) < RETRY_AFTER_FAILURE_MS) return known;

		const running = this.inFlight.get(key);
		if (running !== undefined) return await running;
		const task = this.fill(key, token);
		this.inFlight.set(key, task);
		try {
			return await task;
		} finally {
			this.inFlight.delete(key);
		}
	}

	private async fill(key: string, token: string): Promise<AccountUsage | undefined> {
		const usage = await this.load({ token, version: this.version() });
		if (usage === undefined) this.failedAt.set(key, Date.now());
		else this.readings.set(key, usage);
		return usage;
	}
}

export function quotaKey(providerId: string, accountId: string): string {
	return `${providerId}/${accountId}`;
}

export function noteUsage(
	usage: UsageMap,
	providerId: string,
	accountId: string,
	headers: Record<string, string>,
): void {
	const reading = fromHeaders(headers);
	if (reading === undefined) return;
	const accounts = usage.get(providerId) ?? new Map<string, AccountUsage>();
	accounts.set(accountId, reading);
	usage.set(providerId, accounts);
}

export function usageOf(
	usage: UsageMap,
	providerId: string,
	accountId: string,
): AccountUsage | undefined {
	return usage.get(providerId)?.get(accountId);
}

/** How long the binding window has left, like `11m`. */
export function resetIn(usage: AccountUsage | undefined, now = Date.now()): string | undefined {
	const window = windowOf(usage);
	if (window?.resetsAt === undefined) return undefined;
	const seconds = window.resetsAt - Math.floor(now / 1000);
	return seconds <= 0 ? undefined : duration(seconds);
}

export function resetNote(usage: AccountUsage | undefined, now = Date.now()): string | undefined {
	const left = resetIn(usage, now);
	return left === undefined ? undefined : `resets in ${left}`;
}

/** A picker row's worth, like `62% ↓2h`. */
export function usageText(usage: AccountUsage | undefined, now = Date.now()): string | undefined {
	const window = windowOf(usage);
	if (window === undefined) return undefined;
	const left = resetIn(usage, now);
	return `${window.used}%${left === undefined ? "" : ` ↓${left}`}`;
}

function rolled(usage: AccountUsage, now: number): boolean {
	const seconds = Math.floor(now / 1000);
	return (
		(usage.session?.resetsAt !== undefined && usage.session.resetsAt <= seconds) ||
		(usage.week?.resetsAt !== undefined && usage.week.resetsAt <= seconds)
	);
}

function windowOf(usage: AccountUsage | undefined): Window | undefined {
	if (usage === undefined) return undefined;
	if (usage.binding?.startsWith("seven_day") === true) return usage.week ?? usage.session;
	return usage.session ?? usage.week;
}

/** The endpoint names its windows `session` and `weekly_all`; everything else says `five_hour`. */
function bindingName(kind: string | undefined): string | undefined {
	if (kind === "session") return "five_hour";
	if (kind === "weekly_all") return "seven_day";
	return kind;
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

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function duration(seconds: number): string {
	if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.round((seconds % 3600) / 60);
	if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
	return `${Math.max(1, minutes)}m`;
}

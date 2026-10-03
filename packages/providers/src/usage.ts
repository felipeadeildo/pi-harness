// The quota the provider reports. Every inference response carries the plan's windows as headers, so
// the account that served it gets a reading for free. Reading the endpoint is only for when there is
// no reading yet, and it lands in the same shape.

/** One window of the plan: how much is spent, and when it rolls over. */
export interface Window {
	/** Percent used, 0..100. */
	used: number;
	/** Unix seconds when the window resets. */
	resetsAt?: number;
}

/** What one account's plan reported, from the last response that carried it. */
export interface AccountUsage {
	readAt: number;
	/** `allowed`, `allowed_warning` or `rejected`. */
	status?: string;
	/** The window the provider says is binding, like `five_hour`. */
	binding?: string;
	session?: Window;
	week?: Window;
}

/** The readings of a session, by provider and account. */
export type UsageMap = Map<string, Map<string, AccountUsage>>;

const PREFIX = "anthropic-ratelimit-unified-";

/** The plan's windows in a response, or undefined when the response does not carry them. */
export function fromHeaders(headers: Record<string, string>): AccountUsage | undefined {
	const lower: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;

	const session = windowFrom(lower, "5h");
	const week = windowFrom(lower, "7d");
	if (session === undefined && week === undefined) return undefined;

	const status = lower[`${PREFIX}status`];
	const binding = lower[`${PREFIX}representative-claim`];
	return {
		readAt: Date.now(),
		...(status === undefined ? {} : { status }),
		...(binding === undefined ? {} : { binding }),
		...(session === undefined ? {} : { session }),
		...(week === undefined ? {} : { week }),
	};
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

/** How long until the binding window rolls over, or undefined when there is no reading for it. */
export function resetNote(usage: AccountUsage | undefined, now = Date.now()): string | undefined {
	const window = windowOf(usage);
	if (window?.resetsAt === undefined) return undefined;
	const seconds = window.resetsAt - Math.floor(now / 1000);
	return seconds <= 0 ? undefined : `resets in ${duration(seconds)}`;
}

function windowOf(usage: AccountUsage | undefined): Window | undefined {
	if (usage === undefined) return undefined;
	if (usage.binding?.startsWith("seven_day") === true) return usage.week ?? usage.session;
	return usage.session ?? usage.week;
}

function windowFrom(headers: Record<string, string>, key: string): Window | undefined {
	const used = number(headers[`${PREFIX}${key}-utilization`]);
	if (used === undefined) return undefined;
	const resetsAt = number(headers[`${PREFIX}${key}-reset`]);
	return {
		// The headers carry a fraction; a percent is what a person reads.
		used: Math.round(Math.max(0, Math.min(1, used)) * 1000) / 10,
		...(resetsAt === undefined || resetsAt <= 0 ? {} : { resetsAt: Math.round(resetsAt) }),
	};
}

function number(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function duration(seconds: number): string {
	if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
	return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
}

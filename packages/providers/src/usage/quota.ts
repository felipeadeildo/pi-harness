// Reads a plan once per account and keeps the answer for the process. The record the caller gives
// decides the reader of each provider, so another provider is another entry.
import type { AccountUsage, QuotaReader, UsageRequest } from "./types.ts";

const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

export function quotaKey(providerId: string, accountId: string): string {
	return `${providerId}/${accountId}`;
}

export class Quota {
	private readonly readings = new Map<string, AccountUsage>();
	private readonly inFlight = new Map<string, Promise<AccountUsage | undefined>>();
	private readonly failedAt = new Map<string, number>();

	constructor(private readonly readers: Record<string, QuotaReader | undefined>) {}

	read(providerId: string, accountId: string): AccountUsage | undefined {
		return this.readings.get(quotaKey(providerId, accountId));
	}

	/** The windows a response of this provider carries, when its reader knows them. */
	fromHeaders(providerId: string, headers: Record<string, string>): AccountUsage | undefined {
		return this.readers[providerId]?.headers?.(headers);
	}

	async ensure(
		providerId: string,
		accountId: string,
		token: string | undefined,
	): Promise<AccountUsage | undefined> {
		const reader = this.readers[providerId];
		if (reader === undefined || token === undefined) return undefined;
		const key = quotaKey(providerId, accountId);
		const known = this.readings.get(key);
		if (known !== undefined && !rolled(known, Date.now())) return known;
		if (Date.now() - (this.failedAt.get(key) ?? 0) < RETRY_AFTER_FAILURE_MS) return known;

		const running = this.inFlight.get(key);
		if (running !== undefined) return await running;
		const task = this.fill(key, reader, token);
		this.inFlight.set(key, task);
		try {
			return await task;
		} finally {
			this.inFlight.delete(key);
		}
	}

	/** The reader first; when it refuses, its fallback still carries the windows. */
	private async fill(
		key: string,
		reader: QuotaReader,
		token: string,
	): Promise<AccountUsage | undefined> {
		const request: UsageRequest = { token };
		const usage = (await reader.read(request)) ?? (await reader.probe?.(request));
		if (usage === undefined) this.failedAt.set(key, Date.now());
		else this.readings.set(key, usage);
		return usage;
	}
}

/** A window that already rolled over makes the reading stale. */
function rolled(usage: AccountUsage, now: number): boolean {
	const seconds = Math.floor(now / 1000);
	return (
		(usage.session?.resetsAt !== undefined && usage.session.resetsAt <= seconds) ||
		(usage.week?.resetsAt !== undefined && usage.week.resetsAt <= seconds)
	);
}

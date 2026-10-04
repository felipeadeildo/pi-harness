// Reading a plan's windows: the names a person sees, the reset countdown, and the map the session
// keeps. Nothing here knows a provider.
import type { AccountUsage, NamedWindow, UsageMap, UsageWindow, Window } from "./types.ts";

export function noteUsage(
	usage: UsageMap,
	providerId: string,
	accountId: string,
	reading: AccountUsage | undefined,
): void {
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

/** The windows of a reading, ready to show. */
export function windowsOf(usage: AccountUsage | undefined, now = Date.now()): UsageWindow[] {
	return namedWindows(usage, now).map((named) => {
		const left = leftOf(named.window, now);
		if (left === undefined) return { name: named.name, used: named.window.used };
		return { name: named.name, used: named.window.used, resetsIn: left };
	});
}

/** The window closest to its limit. */
export function worstWindow(
	usage: AccountUsage | undefined,
	now = Date.now(),
): NamedWindow | undefined {
	return namedWindows(usage, now).reduce<NamedWindow | undefined>(
		(worst, candidate) =>
			worst === undefined || candidate.window.used > worst.window.used ? candidate : worst,
		undefined,
	);
}

/** How long the worst window has left, like `11m`. */
export function resetIn(usage: AccountUsage | undefined, now = Date.now()): string | undefined {
	const shown = worstWindow(usage, now);
	return shown === undefined ? undefined : leftOf(shown.window, now);
}

export function resetNote(usage: AccountUsage | undefined, now = Date.now()): string | undefined {
	const left = resetIn(usage, now);
	return left === undefined ? undefined : `resets in ${left}`;
}

/** The windows the reading knows, a window that already rolled counted as empty. */
function namedWindows(usage: AccountUsage | undefined, now: number): NamedWindow[] {
	if (usage === undefined) return [];
	const named: NamedWindow[] = [];
	if (usage.session !== undefined)
		named.push({ name: "5h", window: effective(usage.session, now) });
	if (usage.week !== undefined) named.push({ name: "week", window: effective(usage.week, now) });
	return named;
}

function effective(window: Window, now: number): Window {
	if (window.resetsAt !== undefined && window.resetsAt <= Math.floor(now / 1000))
		return { used: 0 };
	return window;
}

function leftOf(window: Window, now: number): string | undefined {
	if (window.resetsAt === undefined) return undefined;
	const seconds = window.resetsAt - Math.floor(now / 1000);
	return seconds <= 0 ? undefined : duration(seconds);
}

function duration(seconds: number): string {
	if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
	if (seconds >= 3_600) return `${Math.round(seconds / 3_600)}h`;
	return `${Math.max(1, Math.round(seconds / 60))}m`;
}

// Numbers and places as the page prints them: short, and the same on every screen.

/** "now", "12s", "4m", "2h", "3d". */
export function ago(at: number, now: number): string {
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 5) return "now";
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/** "0.4s", "12s", "3m 05s", "1h 02m". */
export function duration(ms: number): string {
	if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A home folder reads as `~`; the page does not know the machine's, so it reads the usual places. */
export function shortPath(path: string): string {
	const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
	return trimmed.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}

export function folderOf(path: string): string {
	return path.split("/").findLast((part) => part !== "") ?? path;
}

export function money(total: number | undefined): string {
	return total === undefined ? "" : `$${total.toFixed(2)}`;
}

/** The share of the window, 0 to 1, or undefined without a window. */
export function contextShare(
	context: { tokens: number; window?: number } | undefined,
): number | undefined {
	if (context?.window === undefined || context.window <= 0) return undefined;
	return Math.min(1, Math.max(0, context.tokens / context.window));
}

export function tokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

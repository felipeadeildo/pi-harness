// What a plan reports, and the shape every provider reader returns. Nothing here knows Anthropic.

/** Percent used, and the unix second the window resets. */
export interface Window {
	used: number;
	resetsAt?: number;
}

export interface AccountUsage {
	session?: Window;
	week?: Window;
}

/** One window, with the name a person reads. */
export interface NamedWindow {
	name: string;
	window: Window;
}

/** One window of a reading, ready to show. */
export interface UsageWindow {
	name: string;
	used: number;
	resetsIn?: string;
}

/** The readings of a session, by provider and account. */
export type UsageMap = Map<string, Map<string, AccountUsage>>;

/** What a reader needs to ask a provider. */
export interface UsageRequest {
	token: string;
	signal?: AbortSignal;
}

/** The windows of one plan; undefined when it could not be read. Never throws. */
export type UsageReader = (request: UsageRequest) => Promise<AccountUsage | undefined>;

/** How to read one provider's plan. */
export interface QuotaReader {
	/** The source that reports the windows. */
	read: UsageReader;
	/** The fallback when `read` refuses, like a one-token call. */
	probe?: UsageReader;
	/** The windows a normal response carries, when the provider does. */
	headers?: (headers: Record<string, string>) => AccountUsage | undefined;
}

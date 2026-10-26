/** Percent used, and the unix second the window resets. */
export interface Window {
	used: number;
	resetsAt?: number;
}

export interface AccountUsage {
	session?: Window;
	week?: Window;
}

export interface NamedWindow {
	name: string;
	window: Window;
}

export interface UsageWindow {
	name: string;
	used: number;
	resetsIn?: string;
}

export type UsageMap = Map<string, Map<string, AccountUsage>>;

export interface UsageRequest {
	token: string;
	signal?: AbortSignal;
}

/** Undefined when it could not be read. Never throws. */
export type UsageReader = (request: UsageRequest) => Promise<AccountUsage | undefined>;

export interface QuotaReader {
	read: UsageReader;
	/** Like a one-token call. */
	probe?: UsageReader;
	headers?: (headers: Record<string, string>) => AccountUsage | undefined;
}

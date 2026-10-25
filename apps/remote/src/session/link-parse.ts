// What a deep link says, apart from the API that reads one: the rule is testable, the reader is not.

/** The parts of an address the login and the socket need, from a page or from a link. */
export interface Link {
	protocol: string;
	host: string;
	pathname: string;
	search: string;
	hash: string;
}

/** What `expo-linking` parses out of a URL. */
export interface Parsed {
	scheme: string | null;
	hostname: string | null;
	path: string | null;
	queryParams: Record<string, undefined | string | string[]> | null;
}

/**
 * The address a deep link names. A link without a host is refused, not guessed: `localhost` would open the
 * phone itself, and the daemon is rarely there.
 */
export function parseLink(parsed: Parsed, fallbackScheme = "piremote"): Link | undefined {
	if (parsed.hostname === null || parsed.hostname === "") return undefined;
	const token = parsed.queryParams?.token;
	return {
		protocol: parsed.scheme ?? fallbackScheme,
		// `hostname` keeps the port when the link carries one, which is how a daemon on 7878 is named.
		host: parsed.hostname,
		pathname: parsed.path ?? "",
		search: "",
		hash: typeof token === "string" ? `#token=${token}` : "",
	};
}

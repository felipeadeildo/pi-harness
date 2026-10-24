// The login a link carries. A link has a one-time token in its fragment, which never reaches a server
// in a request; the page trades it for a login cookie and takes the token out of the address, so it
// does not stay in the history or in a screenshot. Only then does the socket open, because the cookie
// is what the daemon accepts for `/ws`.
import { type Cache, memoryCache } from "@adeildo/pi-remote-client";

/** Where the token rides in the link: after `#`, so no request ever carries it. */
export const TOKEN_KEY = "token";

/** The token in a location's hash, or undefined when the link carries none. */
export function tokenOf(hash: string): string | undefined {
	const params = new URLSearchParams(hash.replace(/^#/, ""));
	const token = params.get(TOKEN_KEY);
	return token === null || token === "" ? undefined : token;
}

/** The address without the token: the fragment goes, and so does the login it carried. */
export function withoutToken(location: { pathname: string; search: string; hash: string }): string {
	return `${location.pathname}${location.search}`;
}

export interface LoggedIn {
	/** Whether the page may open the socket, and the cache it should draw from. */
	ok: boolean;
	cache: Cache;
	/** What went wrong, for a page that cannot draw anything yet. */
	why?: string;
}

/** How the page talks to the daemon. Injected so a test does not need a server. */
export interface Exchange {
	/** Answers 204 with the login cookie, or a refusal the page shows. */
	login(token: string): Promise<{ ok: boolean; status: number }>;
}

/**
 * The exchange over `fetch`, with the cookie made explicit. The browser already sends it for the
 * page's own origin, and saying so keeps it true if a wrapper ever defaults to `omit`.
 */
export const fetchLogin: Exchange = {
	async login(token) {
		const answer = await fetch("/login", {
			method: "POST",
			credentials: "same-origin",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token }),
		});
		return { ok: answer.ok, status: answer.status };
	},
};

/**
 * Trades the token for the cookie, once. A 204 means the browser now holds the login and the socket
 * will be let in. A refusal is final for this link: a token is spent or late, and asking again with
 * the same one cannot work, so the page says so instead of retrying.
 */
export async function logIn(
	location: { pathname: string; search: string; hash: string; replaceState: (url: string) => void },
	options: { exchange: Exchange; cache: Cache },
): Promise<LoggedIn> {
	const token = tokenOf(location.hash);
	if (token === undefined) return { ok: true, cache: options.cache };
	// Gone from the address before the request goes out: a screenshot or a shared tab must not carry it.
	location.replaceState(withoutToken(location));
	const answer = await options.exchange.login(token);
	if (answer.ok) return { ok: true, cache: options.cache };
	// The two refusals are different to the person reading them: a spent or late link, or the request
	// itself going wrong. Telling them apart is what stops someone asking for a link that was fine.
	const why =
		answer.status === 401
			? "This link was used or has expired. Ask pi for a new one with /remote."
			: `The daemon could not answer the login (${answer.status}). Try the link again.`;
	return { ok: false, cache: memoryCache(), why };
}

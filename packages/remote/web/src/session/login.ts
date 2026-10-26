// A link's one-time token travels in the fragment, is traded for a cookie, then removed from the
// address so it stays out of history and screenshots. The socket opens after that.
import { type Cache, memoryCache } from "@adeildo/pi-remote-protocol/client";

/** Where the token rides in the link: after `#`, so no request ever carries it. */
const TOKEN_KEY = "token";

/** The token in a location's hash, or undefined when the link carries none. */
export function tokenOf(hash: string): string | undefined {
	const params = new URLSearchParams(hash.replace(/^#/, ""));
	const token = params.get(TOKEN_KEY);
	return token === null || token === "" ? undefined : token;
}

/** Strips the login from any URL sent out, including the navigation timing entry. */
export function withoutFragment(url: string): string {
	const at = url.indexOf("#");
	return at === -1 ? url : url.slice(0, at);
}

/** The address without the token: the fragment goes, and so does the login it carried. */
export function withoutToken(location: { pathname: string; search: string; hash: string }): string {
	return withoutFragment(`${location.pathname}${location.search}${location.hash}`);
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

/** A refusal is final for this link: a spent or late token never works again. */
export async function logIn(
	location: { pathname: string; search: string; hash: string; replaceState: (url: string) => void },
	options: { exchange: Exchange; cache: Cache },
): Promise<LoggedIn> {
	const token = tokenOf(location.hash);
	if (token === undefined) return { ok: true, cache: options.cache };
	// Gone from the address before the request goes out: a screenshot or a shared tab must not carry it.
	location.replaceState(withoutToken(location));
	let answer: { ok: boolean; status: number };
	try {
		answer = await options.exchange.login(token);
	} catch {
		// The daemon may be restarting, or the network gone. The token is spent either way, because it
		// left the address, so this is a sentence and not a retry: asking for a new link is the way back.
		return {
			ok: false,
			cache: memoryCache(),
			why: "The daemon could not be reached. Check that pi is running, then ask for a new link with /remote.",
		};
	}
	if (answer.ok) return { ok: true, cache: options.cache };
	// The two refusals are different to the person reading them: a spent or late link, or the request
	// itself going wrong. Telling them apart is what stops someone asking for a link that was fine.
	const why =
		answer.status === 401
			? "This link was used or has expired. Ask pi for a new one with /remote."
			: `The daemon could not answer the login (${answer.status}). Try the link again.`;
	return { ok: false, cache: memoryCache(), why };
}

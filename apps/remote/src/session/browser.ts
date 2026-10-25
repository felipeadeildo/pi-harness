// How the app reaches a daemon: the address comes from the page on the web and from the opening link on
// a phone, and the login spends the token once.
import { pageCache } from "./cache.ts";
import { type Link, linkOf, openingUrl, pageLink } from "./link.ts";
import { fetchLogin, logIn } from "./login.ts";
import { appStorage } from "./store";
import { openSocket, socketUrl } from "./transport.ts";
import type { SessionSource } from "./use-session.ts";

let made: Promise<SessionSource> | undefined;

/**
 * The source for a session at `at`: the page's own address by default, and the link that opened the app
 * on a phone, where there is no page to read and the daemon is somewhere else on the network.
 */
export function sourceAt(at: Link = pageLink()): Promise<SessionSource> {
	// Once per page: a screen that draws again, or two screens, must not spend the token twice.
	made ??= logIn(
		{
			pathname: at.pathname,
			search: at.search,
			hash: at.hash,
			replaceState: (url) => globalThis.history?.replaceState(null, "", url),
		},
		{ exchange: fetchLogin, cache: pageCache(appStorage) },
	).then((logged) => ({
		cache: logged.cache,
		// The page knows it is a browser; which device it is arrives with the marks C9 draws.
		clientName: "browser",
		open: openSocket(socketUrl(at), (url) => new WebSocket(url)),
		...(logged.why === undefined ? {} : { why: logged.why }),
	}));
	return made;
}

/** The source of the screen in front of the person: the page's own address, or the link that opened it. */
export function browserSource(): Promise<SessionSource> {
	if (globalThis.location !== undefined) return sourceAt(pageLink());
	return openingUrl().then((url) =>
		url === undefined || url === null
			? ({ why: "this app was not opened by a daemon link" } as SessionSource)
			: phoneSource(url),
	);
}

/** The source a phone reaches through the link that opened it, or the reason it cannot. */
export function phoneSource(url: string): Promise<SessionSource> {
	const at = linkOf(url);
	if (at === undefined)
		return Promise.resolve({
			why: "this link names no daemon address",
		} as SessionSource);
	return sourceAt(at);
}

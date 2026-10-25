// The browser's own pieces for a session: its storage for the cache and a WebSocket on the page's
// origin. The login happens once per page, because the token in the link works once.
import { pageCache } from "./cache.ts";
import { fetchLogin, logIn } from "./login.ts";
import { appStorage } from "./store";
import { openSocket, socketUrl } from "./transport.ts";
import type { SessionSource } from "./use-session.ts";

let made: Promise<SessionSource> | undefined;

/** The page's storage, and the socket the daemon lets in once the login is done. */
export function browserSource(): Promise<SessionSource> {
	// Once per page: a screen that draws again, or two screens, must not spend the token twice.
	made ??= logIn(
		{
			pathname: globalThis.location.pathname,
			search: globalThis.location.search,
			hash: globalThis.location.hash,
			replaceState: (url) => globalThis.history.replaceState(null, "", url),
		},
		{ exchange: fetchLogin, cache: pageCache(appStorage) },
	).then((logged) => ({
		cache: logged.cache,
		// The page knows it is a browser; which device it is arrives with the marks C9 draws.
		clientName: "browser",
		open: openSocket(socketUrl(globalThis.location), (url) => new WebSocket(url)),
		...(logged.why === undefined ? {} : { why: logged.why }),
	}));
	return made;
}

// How the page reaches its daemon: the page's own origin, with the login spent once. The page is
// served by the daemon, so there is one address and it is `location`.
import { pageCache } from "./cache.ts";
import { fetchLogin, logIn } from "./login.ts";
import { openSocket, socketUrl } from "./transport.ts";
import type { SessionSource } from "./use-session.ts";

let made: Promise<SessionSource> | undefined;

/** The source for every screen of this page: one login, whatever draws first. */
export function browserSource(): Promise<SessionSource> {
	// Once per page: a screen that draws again, or two screens, must not spend the token twice.
	made ??= logIn(
		{
			pathname: location.pathname,
			search: location.search,
			hash: location.hash,
			replaceState: (url) => history.replaceState(null, "", url),
		},
		{ exchange: fetchLogin, cache: pageCache(() => localStorage) },
	).then((logged) => ({
		cache: logged.cache,
		clientName: "browser",
		open: openSocket(socketUrl(location), (url) => new WebSocket(url)),
		...(logged.why === undefined ? {} : { why: logged.why }),
	}));
	return made;
}

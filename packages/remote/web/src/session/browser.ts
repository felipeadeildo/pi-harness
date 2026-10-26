// The page reaches its daemon on its own origin, with the login spent once.
import { pageCache } from "./cache.ts";
import { fetchLogin, logIn } from "./login.ts";
import { openSocket, socketUrl } from "./transport.ts";
import type { SessionSource } from "./use-session.ts";

let made: Promise<SessionSource> | undefined;

export function browserSource(): Promise<SessionSource> {
	// Once per page, so two screens never spend the token twice.
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
		open: (key) => openSocket(socketUrl(location, key.machine), (url) => new WebSocket(url)),
		...(logged.why === undefined ? {} : { why: logged.why }),
	}));
	return made;
}

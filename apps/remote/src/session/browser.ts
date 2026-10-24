// The browser's own pieces for a session: its storage for the cache and a WebSocket on the page's
// origin. Made once, so a screen that draws again does not reconnect.
import { pageCache } from "./cache.ts";
import { openSocket, socketUrl } from "./transport.ts";
import type { SessionSource } from "./use-session.ts";

let source: SessionSource | undefined;

export function browserSource(): SessionSource {
	source ??= {
		cache: pageCache(() => globalThis.localStorage),
		open: openSocket(socketUrl(globalThis.location), (url) => new WebSocket(url)),
	};
	return source;
}

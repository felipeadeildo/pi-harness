// The cache's storage in a browser. Reading `localStorage` throws when the page may not use it, and
// `pageCache` is what turns that into a cache that lasts as long as the page.
import type { StorageLike } from "./cache.ts";

export function appStorage(): StorageLike {
	return globalThis.localStorage;
}

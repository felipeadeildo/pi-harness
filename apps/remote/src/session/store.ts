// The cache's storage on iOS and Android: SQLite's key-value store, which the cache reads and writes
// in the same synchronous shape as the page's `localStorage`. The web build takes `store.web.ts`.
import Storage from "expo-sqlite/kv-store";

import type { StorageLike } from "./cache.ts";

export function appStorage(): StorageLike {
	return {
		getItem: (key) => Storage.getItemSync(key),
		setItem: (key, value) => Storage.setItemSync(key, value),
		removeItem: (key) => Storage.removeItemSync(key),
	};
}

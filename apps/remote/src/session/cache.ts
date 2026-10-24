// What the browser keeps of each session between visits, so a reload draws at once from what it had.
// It lives in the page's storage, one item per session; an item that does not read is a cold open.
import type { Cache, CachedSession, SessionKey } from "@adeildo/pi-remote-client";

/** The part of the Web Storage API the cache uses. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const PREFIX = "pi-remote:session:";

function itemOf(key: SessionKey): string {
	return `${PREFIX}${key.machine}\n${key.session}`;
}

export function storageCache(storage: StorageLike): Cache {
	return {
		read: async (key) => {
			const text = storage.getItem(itemOf(key));
			if (text === null) return undefined;
			try {
				const value = JSON.parse(text) as CachedSession;
				return Array.isArray(value.entries) && Array.isArray(value.facts) ? value : undefined;
			} catch {
				return undefined;
			}
		},
		write: async (value) => {
			// A full store keeps the page working; the next visit is a cold open, not an error.
			try {
				storage.setItem(itemOf(value.key), JSON.stringify(value));
			} catch {}
		},
		drop: async (key) => {
			storage.removeItem(itemOf(key));
		},
	};
}

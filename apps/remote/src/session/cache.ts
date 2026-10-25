// What the app keeps of each session between visits, so a reload draws at once from what it had.
// It lives in the platform's storage (`store.ts`), one item per session; an item that does not
// read is a cold open.
// The store is small and shared with nothing else of ours, so it keeps the sessions written last and
// lets the oldest go, instead of filling up and turning every next visit into a cold open.
import {
	type Cache,
	type CachedSession,
	memoryCache,
	type SessionKey,
} from "@adeildo/pi-remote-client";

/** The part of the Web Storage API the cache uses, which is also the shape `store.ts` gives native. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const PREFIX = "pi-remote:session:";
/** The keys of the sessions kept, the one written last at the end. */
const ORDER = "pi-remote:sessions";
/** How many sessions the store keeps. */
export const KEPT = 20;

function itemOf(key: SessionKey): string {
	return `${PREFIX}${key.machine}\n${key.session}`;
}

function orderOf(storage: StorageLike): string[] {
	try {
		const value: unknown = JSON.parse(storage.getItem(ORDER) ?? "[]");
		return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
	} catch {
		return [];
	}
}

export function storageCache(storage: StorageLike, kept = KEPT): Cache {
	return {
		read: async (key) => {
			const text = storage.getItem(itemOf(key));
			if (text === null) return undefined;
			try {
				const value = JSON.parse(text) as CachedSession;
				return Array.isArray(value.entries) && typeof value.state === "object" ? value : undefined;
			} catch {
				return undefined;
			}
		},
		write: async (value) => {
			const item = itemOf(value.key);
			const order = [...orderOf(storage).filter((one) => one !== item), item];
			try {
				for (const old of order.splice(0, Math.max(0, order.length - kept)))
					storage.removeItem(old);
				storage.setItem(item, JSON.stringify(value));
				storage.setItem(ORDER, JSON.stringify(order));
			} catch {
				// A full store keeps the page working. The item it held is older than the session now,
				// so it goes: the next visit opens cold instead of drawing what is no longer true.
				storage.removeItem(item);
			}
		},
		drop: async (key) => {
			const item = itemOf(key);
			storage.removeItem(item);
			storage.setItem(ORDER, JSON.stringify(orderOf(storage).filter((one) => one !== item)));
		},
	};
}

/**
 * The page's storage, or a cache that lasts as long as the page when the browser refuses storage:
 * reading `localStorage` throws when it is blocked for the page, and the screen still opens.
 */
export function pageCache(storage: () => StorageLike): Cache {
	try {
		return storageCache(storage());
	} catch {
		return memoryCache();
	}
}

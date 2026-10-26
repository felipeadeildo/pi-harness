// Each session as it was last drawn, one `localStorage` item per session, so a reload draws at once.
// The oldest items go first when the store fills.
import {
	type Cache,
	type CachedSession,
	memoryCache,
	type SessionKey,
} from "@adeildo/pi-remote-protocol/client";

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const PREFIX = "pi-remote:session:";
const ORDER = "pi-remote:sessions";
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
				// A full store drops this item, so the next visit opens cold instead of drawing stale state.
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

/** Falls back to memory when the browser blocks storage. */
export function pageCache(storage: () => StorageLike): Cache {
	try {
		return storageCache(storage());
	} catch {
		return memoryCache();
	}
}

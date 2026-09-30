// The one place that answers which account a request uses.
import type { Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/**
 * The account a request uses: the session pin, else the store's choice, else none, which means pi's
 * own credential. A request never falls back to "the first account", so adding one does not take
 * over a session by itself.
 */
export function activeAccount(
	store: AccountStore,
	pins: Pins,
	providerId: string,
): Account | undefined {
	const pinned = pins.has(providerId) ? pins.get(providerId) : store.active(providerId)?.id;
	if (pinned === null || pinned === undefined) return undefined;
	return store.accounts(providerId).find((account) => account.id === pinned);
}

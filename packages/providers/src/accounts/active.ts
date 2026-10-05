// The one place that answers which account a request uses.
import type { Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/**
 * The account a request uses: the session pin, else the store's choice, else the first account. A
 * provider with accounts always has one in use; undefined means it has none.
 */
export function activeAccount(
	store: AccountStore,
	pins: Pins,
	providerId: string,
): Account | undefined {
	const accounts = store.accounts(providerId);
	const wanted = pins.get(providerId) ?? store.active(providerId)?.id;
	return accounts.find((account) => account.id === wanted) ?? accounts[0];
}

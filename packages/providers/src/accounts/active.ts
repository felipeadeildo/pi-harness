// The one place that answers which account a request uses.
import type { Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** The session pin, else the store's choice, else the first account. */
export function activeAccount(
	store: AccountStore,
	pins: Pins,
	providerId: string,
): Account | undefined {
	const accounts = store.accounts(providerId);
	const wanted = pins.get(providerId) ?? store.active(providerId)?.id;
	return accounts.find((account) => account.id === wanted) ?? accounts[0];
}

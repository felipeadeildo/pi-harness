// What can be done to an account from any dialog, and the status that follows it: the settings screen,
// /accounts and a login's adoption all go through here.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { activeAccount } from "./active.ts";
import { STATUS_KEY } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";

/** One provider's accounts, as the actions reach them. */
export interface AccountsOf {
	pi: ExtensionAPI;
	store: AccountStore;
	pins: Pins;
	providerId: string;
}

/** Makes an account the one in use, in this session and in the ones that start after it. */
export function useAccount(of: AccountsOf, ctx: ExtensionContext, accountId: string): void {
	of.store.setActive(of.providerId, accountId);
	pin(of.pi, of.pins, of.providerId, accountId);
	refreshStatus(of.store, of.pins, ctx);
}

/** Renames an account, answering with a problem or undefined. */
export function renameAccount(
	of: AccountsOf,
	ctx: ExtensionContext,
	accountId: string,
	label: string,
): string | undefined {
	const problem = of.store.rename(of.providerId, accountId, label);
	if (problem === undefined) refreshStatus(of.store, of.pins, ctx);
	return problem;
}

/** Removes an account; a session pinned to it goes back to the store's choice. */
export function removeAccount(
	of: AccountsOf,
	ctx: ExtensionContext,
	accountId: string,
): string | undefined {
	const problem = of.store.remove(of.providerId, accountId);
	if (problem !== undefined) return problem;
	if (of.pins.get(of.providerId) === accountId) of.pins.delete(of.providerId);
	refreshStatus(of.store, of.pins, ctx);
	return undefined;
}

/** What removing an account asks, saying so when it is the last one the provider has. */
export function removeQuestion(provider: string, label: string, last: boolean): string {
	if (!last) return `Remove the ${provider} account "${label}"?`;
	return `Remove "${label}"? It is the last ${provider} account, so ${provider} goes back to pi's own /login.`;
}

/** The label of the account the current model uses, or undefined when there is nothing to say. */
export function accountStatus(
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
): string | undefined {
	const providerId = ctx.model?.provider;
	if (providerId === undefined) return undefined;
	return activeAccount(store, pins, providerId)?.label;
}

/** Publishes the account next to the model, where every other piece reads it. */
export function refreshStatus(store: AccountStore, pins: Pins, ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, accountStatus(store, pins, ctx));
}

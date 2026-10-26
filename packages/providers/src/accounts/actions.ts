// Account actions shared by the settings screen, /accounts and a login's adoption.
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { activeAccount } from "./active.ts";
import { NAME, STATUS_KEY } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

export interface AccountsOf {
	pi: ExtensionAPI;
	store: AccountStore;
	pins: Pins;
	providerId: string;
}

export async function askName(
	ctx: ExtensionContext,
	title: string,
	suggestion: string,
): Promise<string> {
	return (await ctx.ui.input(title, suggestion))?.trim() || suggestion;
}

export function saveAccount(
	ctx: ExtensionContext,
	store: AccountStore,
	providerId: string,
	label: string,
	credential: Credential,
): Account | undefined {
	const added = store.add(providerId, label, credential);
	if (added.account === undefined) ctx.ui.notify(`${NAME}: ${added.problem}`, "error");
	return added.account;
}

/** In this session and the ones that start after it. */
export function useAccount(of: AccountsOf, ctx: ExtensionContext, accountId: string): void {
	of.store.setActive(of.providerId, accountId);
	pin(of.pi, of.pins, of.providerId, accountId);
	refreshStatus(of.store, of.pins, ctx);
}

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

/** A session pinned to it goes back to the store's choice. */
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

/** Says so when it is the provider's last account. */
export function removeQuestion(provider: string, label: string, last: boolean): string {
	if (!last) return `Remove the ${provider} account "${label}"?`;
	return `Remove "${label}"? It is the last ${provider} account, so ${provider} goes back to pi's own /login.`;
}

export function accountStatus(
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
): string | undefined {
	const providerId = ctx.model?.provider;
	if (providerId === undefined) return undefined;
	return activeAccount(store, pins, providerId)?.label;
}

/** Next to the model, where every other piece reads it. */
export function refreshStatus(store: AccountStore, pins: Pins, ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, accountStatus(store, pins, ctx));
}

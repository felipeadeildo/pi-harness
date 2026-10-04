// The Accounts rows of the settings screen, one tree per provider: the accounts, and under each one
// what can be done to it. Adding stays on `/accounts`, which needs the provider's login dialogs.
import type { FeatureScope, Json, ScreenEntry } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { activeAccount } from "./active.ts";
import { kindText, nativeCredential } from "./login.ts";
import { STATUS_KEY } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import { DEFAULT_LABEL, type Account } from "./types.ts";

/** The value of the choice that means pi's own credential. */
export { DEFAULT_ACCOUNT, DEFAULT_LABEL } from "./types.ts";

/** Everything a provider's rows share. The label is the section header. */
interface ProviderGroup {
	pi: FeatureScope;
	store: AccountStore;
	pins: Pins;
	providerId: string;
	label: string;
}

export function accountRows(
	pi: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
): ScreenEntry[] {
	const rows: ScreenEntry[] = [];
	for (const providerId of store.providerIds().toSorted()) {
		const group: ProviderGroup = {
			pi,
			store,
			pins,
			providerId,
			label: ctx.modelRegistry.getProviderDisplayName(providerId),
		};
		rows.push(
			defaultRow(group),
			...store.accounts(providerId).flatMap((account) => accountBlock(group, account)),
		);
	}
	return rows;
}

/** Pi's own credential, as the first account of the provider. */
function defaultRow(group: ProviderGroup): ScreenEntry {
	const kind = kindText(nativeCredential(group.providerId)?.type) ?? "login";
	return {
		kind: "action",
		id: `accounts.${group.providerId}.default`,
		section: group.label,
		label: DEFAULT_LABEL,
		description: "The credential of /login, which stays in pi's own store.",
		text: () => (inUse(group) ? `${kind}, in use` : kind),
		indent: 1,
		run: (ctx) => {
			group.store.setActive(group.providerId, undefined);
			pin(group.pi, group.pins, group.providerId, null);
			refreshStatus(group.store, group.pins, ctx);
			return `${DEFAULT_LABEL} in use`;
		},
	};
}

/** One account, and its actions, one level deeper. */
function accountBlock(group: ProviderGroup, account: Account): ScreenEntry[] {
	const subscription = account.credential.type === "oauth";
	return [
		{
			kind: "action",
			id: `accounts.${group.providerId}.${account.id}.use`,
			section: group.label,
			label: account.label,
			description: subscription ? "Saved from a subscription login." : "Saved as an API key.",
			text: () => {
				const kind = subscription ? "subscription" : "api key";
				return inUse(group, account) ? `${kind}, in use` : kind;
			},
			indent: 1,
			run: (ctx) => {
				group.store.setActive(group.providerId, account.id);
				pin(group.pi, group.pins, group.providerId, account.id);
				refreshStatus(group.store, group.pins, ctx);
				return `${account.label} in use`;
			},
		},
		{
			kind: "value",
			id: `accounts.${group.providerId}.${account.id}.label`,
			section: group.label,
			label: "Rename",
			description: "What this account is called in the picker.",
			control: { type: "text" },
			indent: 2,
			get: () => account.label,
			set: (value: Json, ctx) => {
				if (typeof value !== "string") return "name it";
				const problem = group.store.rename(group.providerId, account.id, value);
				if (problem === undefined) refreshStatus(group.store, group.pins, ctx);
				return problem;
			},
		},
		{
			kind: "action",
			id: `accounts.${group.providerId}.${account.id}.remove`,
			section: group.label,
			label: "Remove",
			description: `Forget the "${account.label}" credential.`,
			text: () => account.label,
			confirm: `Remove the ${group.providerId} account "${account.label}"?`,
			indent: 2,
			run: (ctx) => {
				const problem = group.store.remove(group.providerId, account.id);
				if (problem !== undefined) return problem;
				if (group.pins.get(group.providerId) === account.id) {
					pin(group.pi, group.pins, group.providerId, null);
				}
				refreshStatus(group.store, group.pins, ctx);
				return `${account.label} removed`;
			},
		},
	];
}

function inUse(group: ProviderGroup, account?: Account): boolean {
	const active = activeAccount(group.store, group.pins, group.providerId);
	return account === undefined ? active === undefined : active?.id === account.id;
}

/** The label of the account the current model uses, or undefined when there is nothing to say. */
export function accountStatus(
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
): string | undefined {
	const providerId = ctx.model?.provider;
	if (providerId === undefined) return undefined;
	if (store.accounts(providerId).length === 0) return undefined;
	return activeAccount(store, pins, providerId)?.label ?? "pi";
}

/** Publishes the account next to the model, where every other piece reads it. */
export function refreshStatus(store: AccountStore, pins: Pins, ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, accountStatus(store, pins, ctx));
}

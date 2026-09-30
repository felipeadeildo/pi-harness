// The Accounts rows of the settings screen: choose the account of a provider, rename one, or remove
// one. Adding stays on `/accounts`, which needs the provider's login dialogs.
import type { FeatureScope, Json, ScreenEntry } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { activeAccount } from "./active.ts";
import { STATUS_KEY } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** The value of the choice that means pi's own credential. */
export const DEFAULT_ACCOUNT = "default";
export const DEFAULT_LABEL = "pi default";

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
		const accounts = store.accounts(providerId);
		rows.push(accountChoice(group, accounts));
		for (const account of accounts) rows.push(...accountBlock(group, account));
	}
	return rows;
}

function accountChoice(group: ProviderGroup, accounts: readonly Account[]): ScreenEntry {
	return {
		kind: "value",
		id: `accounts.${group.providerId}.active`,
		section: group.label,
		label: "Account",
		description:
			"The credential a request uses. Switching mid-conversation re-sends it without its prompt cache.",
		control: {
			type: "choice",
			options: [
				{ value: DEFAULT_ACCOUNT, label: DEFAULT_LABEL },
				...accounts.map((account) => ({ value: account.id, label: account.label })),
			],
		},
		get: () => activeAccount(group.store, group.pins, group.providerId)?.id ?? DEFAULT_ACCOUNT,
		set: (value, ctx) => {
			const known =
				typeof value === "string" &&
				(value === DEFAULT_ACCOUNT || accounts.some((account) => account.id === value));
			if (!known) return "pick an account";

			const chosen = value === DEFAULT_ACCOUNT ? null : value;
			group.store.setActive(group.providerId, chosen ?? undefined);
			pin(group.pi, group.pins, group.providerId, chosen);
			refreshStatus(group.store, group.pins, ctx);
			return undefined;
		},
	};
}

/** One account, as its own block: what it is, what to call it, and how to drop it. */
function accountBlock(group: ProviderGroup, account: Account): ScreenEntry[] {
	const subscription = account.credential.type === "oauth";
	return [
		{
			kind: "info",
			id: `accounts.${group.providerId}.${account.id}.kind`,
			section: group.label,
			label: account.label,
			description: subscription ? "Saved from a subscription login." : "Saved as an API key.",
			text: () => (subscription ? "subscription" : "api key"),
		},
		{
			kind: "value",
			id: `accounts.${group.providerId}.${account.id}.label`,
			section: group.label,
			label: "Rename",
			description: "What this account is called in the picker.",
			control: { type: "text" },
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

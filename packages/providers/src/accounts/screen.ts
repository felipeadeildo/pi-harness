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

export function accountRows(
	pi: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
): ScreenEntry[] {
	const rows: ScreenEntry[] = [];
	for (const providerId of store.providerIds().toSorted()) {
		const section = ctx.modelRegistry.getProviderDisplayName(providerId);
		const accounts = store.accounts(providerId);
		rows.push(activeRow(pi, store, pins, providerId, section, accounts));
		for (const account of accounts)
			rows.push(...accountGroup(pi, store, pins, providerId, section, account));
	}
	return rows;
}

function activeRow(
	pi: FeatureScope,
	store: AccountStore,
	pins: Pins,
	providerId: string,
	section: string,
	accounts: readonly Account[],
): ScreenEntry {
	return {
		kind: "value",
		id: `accounts.${providerId}.active`,
		section,
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
		get: () => activeAccount(store, pins, providerId)?.id ?? DEFAULT_ACCOUNT,
		set: (value, ctx) => {
			const chosen =
				value === DEFAULT_ACCOUNT ||
				(typeof value === "string" && accounts.some((a) => a.id === value))
					? value
					: undefined;
			if (chosen === undefined) return "pick an account";
			store.setActive(providerId, chosen === DEFAULT_ACCOUNT ? undefined : chosen);
			pin(pi, pins, providerId, chosen === DEFAULT_ACCOUNT ? null : chosen);
			refreshStatus(store, pins, ctx);
			return undefined;
		},
	};
}

/** One account, as its own block: what it is, what to call it, and how to drop it. */
function accountGroup(
	pi: FeatureScope,
	store: AccountStore,
	pins: Pins,
	providerId: string,
	section: string,
	account: Account,
): ScreenEntry[] {
	return [
		{
			kind: "info",
			id: `accounts.${providerId}.${account.id}.kind`,
			section,
			label: account.label,
			description: `Saved ${account.credential.type === "oauth" ? "from a subscription login" : "as an API key"}.`,
			text: () => (account.credential.type === "oauth" ? "subscription" : "api key"),
		},
		{
			kind: "value",
			id: `accounts.${providerId}.${account.id}.label`,
			section,
			label: "Rename",
			description: "What this account is called in the picker.",
			control: { type: "text" },
			get: () => account.label,
			set: (value: Json, ctx) => {
				if (typeof value !== "string") return "name it";
				const problem = store.rename(providerId, account.id, value);
				if (problem === undefined) refreshStatus(store, pins, ctx);
				return problem;
			},
		},
		{
			kind: "action",
			id: `accounts.${providerId}.${account.id}.remove`,
			section,
			label: "Remove",
			description: `Forget the "${account.label}" credential.`,
			text: () => account.label,
			confirm: `Remove the ${providerId} account "${account.label}"?`,
			run: (ctx) => {
				const problem = store.remove(providerId, account.id);
				if (problem !== undefined) return problem;
				if (pins.get(providerId) === account.id) pin(pi, pins, providerId, null);
				refreshStatus(store, pins, ctx);
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

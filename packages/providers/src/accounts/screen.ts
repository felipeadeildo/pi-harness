// The Accounts rows of the settings screen, one tree per provider: the accounts, and under each one
// what can be done to it. Adding stays on `/accounts`, which needs the provider's login dialogs.
import type { FeatureScope, Json, ScreenEntry } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	type AccountsOf,
	removeAccount,
	removeQuestion,
	renameAccount,
	useAccount,
} from "./actions.ts";
import { activeAccount } from "./active.ts";
import { kindText } from "./login.ts";
import type { Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** Everything a provider's rows share. The label is the section header. */
interface ProviderGroup extends AccountsOf {
	label: string;
}

export function accountRows(
	pi: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
): ScreenEntry[] {
	return store
		.providerIds()
		.toSorted()
		.flatMap((providerId) => {
			const group: ProviderGroup = {
				pi,
				store,
				pins,
				providerId,
				label: ctx.modelRegistry.getProviderDisplayName(providerId),
			};
			return store.accounts(providerId).flatMap((account) => accountBlock(group, account));
		});
}

/** One account, and its actions, one level deeper. */
function accountBlock(group: ProviderGroup, account: Account): ScreenEntry[] {
	const kind = kindText(account.credential.type);
	const last = group.store.accounts(group.providerId).length === 1;
	return [
		{
			kind: "action",
			id: `accounts.${group.providerId}.${account.id}.use`,
			section: group.label,
			label: account.label,
			description:
				account.credential.type === "oauth"
					? "Saved from a subscription login."
					: "Saved as an API key.",
			text: () => (inUse(group, account) ? `${kind}, in use` : kind),
			indent: 1,
			run: (ctx) => {
				useAccount(group, ctx, account.id);
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
				return renameAccount(group, ctx, account.id, value);
			},
		},
		{
			kind: "action",
			id: `accounts.${group.providerId}.${account.id}.remove`,
			section: group.label,
			label: "Remove",
			description: `Forget the "${account.label}" credential.`,
			text: () => account.label,
			confirm: removeQuestion(group.label, account.label, last),
			indent: 2,
			run: (ctx) => removeAccount(group, ctx, account.id) ?? `${account.label} removed`,
		},
	];
}

function inUse(group: ProviderGroup, account: Account): boolean {
	return activeAccount(group.store, group.pins, group.providerId)?.id === account.id;
}

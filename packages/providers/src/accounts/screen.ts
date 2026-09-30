// The Accounts rows of the settings screen: pick the account of a provider for this session,
// rename one, or remove one. Adding stays on `/accounts`, which needs the provider's login dialogs.
import type { FeatureScope, Json, ScreenEntry } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { pin, type Pins } from "./pins.ts";
import { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

export const DEFAULT_LABEL = "pi default";
export const STATUS_KEY = "pi-providers:accounts";
const SECTION = "Accounts";

export function accountRows(pi: FeatureScope, store: AccountStore, pins: Pins): ScreenEntry[] {
	const rows: ScreenEntry[] = [];
	for (const providerId of store.providerIds().toSorted()) {
		const accounts = store.accounts(providerId);
		rows.push({
			kind: "value",
			id: `accounts.${providerId}.active`,
			section: SECTION,
			label: `${providerId} account`,
			description: `${describeCount(accounts.length)} for ${providerId}. ${DEFAULT_LABEL} is the credential of /login.`,
			control: {
				type: "choice",
				options: [
					{ value: "default", label: DEFAULT_LABEL },
					...accounts.map((account) => ({ value: account.id, label: account.label })),
				],
			},
			get: () => current(store, pins, providerId, accounts),
			set: (value, ctx) => {
				if (value === "default") {
					pin(pi, pins, providerId, null);
					refreshStatus(store, pins, ctx);
					return undefined;
				}
				if (typeof value !== "string" || !accounts.some((account) => account.id === value)) {
					return "pick an account";
				}
				pin(pi, pins, providerId, value);
				refreshStatus(store, pins, ctx);
				return undefined;
			},
		});
		for (const account of accounts) rows.push(...accountRow(pi, store, pins, providerId, account));
	}
	return rows;
}

function accountRow(
	pi: FeatureScope,
	store: AccountStore,
	pins: Pins,
	providerId: string,
	account: Account,
): ScreenEntry[] {
	return [
		{
			kind: "value",
			id: `accounts.${providerId}.${account.id}.label`,
			section: SECTION,
			label: `${providerId} · rename`,
			description: `${account.credential.type === "oauth" ? "OAuth" : "API key"} credential, named ${account.label}.`,
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
			section: SECTION,
			label: `Remove ${account.label}`,
			description: `${providerId} loses this credential for good.`,
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
	const accounts = store.accounts(providerId);
	if (accounts.length === 0) return undefined;
	const pinned = pins.has(providerId) ? pins.get(providerId) : store.active(providerId)?.id;
	if (pinned === null || pinned === undefined) return "pi";
	return accounts.find((account) => account.id === pinned)?.label ?? "pi";
}

/** Publishes the account next to the model, where every other piece reads it. */
export function refreshStatus(store: AccountStore, pins: Pins, ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, accountStatus(store, pins, ctx));
}

/** The value the choice shows: the session pin, else the store's default, else `default`. */
function current(
	store: AccountStore,
	pins: Pins,
	providerId: string,
	accounts: readonly Account[],
): string {
	const pinned = pins.has(providerId) ? pins.get(providerId) : store.active(providerId)?.id;
	if (pinned === null || pinned === undefined) return "default";
	return accounts.some((account) => account.id === pinned) ? pinned : "default";
}

function describeCount(count: number): string {
	if (count === 1) return "1 extra account";
	return `${count} extra accounts`;
}

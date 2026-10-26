// After a provider login the credential gets a name, replacing an account or becoming a new one.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { pick } from "../ui/picker.ts";
import { type AccountsOf, askName, saveAccount, useAccount } from "./actions.ts";
import { activeAccount } from "./active.ts";
import { NAME } from "./names.ts";
import type { Pins } from "./pins.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** Closing the dialog keeps the credential as a new account, since pi's own copy is not one. */
export async function adoptAccount(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
	credential: Credential,
): Promise<void> {
	const provider = ctx.modelRegistry.getProviderDisplayName(providerId);
	const of: AccountsOf = { pi: scope, store, pins, providerId };
	const current = activeAccount(store, pins, providerId)?.id;
	const choices: { account: Account | undefined; label: string }[] = store
		.accounts(providerId)
		.map((account) => ({
			account,
			label: `Replace ${account.label}${account.id === current ? " (in use)" : ""}`,
		}));
	choices.push({ account: undefined, label: "New account" });

	const picked = ctx.hasUI
		? await pick(
				ctx,
				`Keep this ${provider} login as`,
				choices.map((choice) => choice.label),
			)
		: undefined;
	const choice = choices.find((candidate) => candidate.label === picked);

	if (choice?.account !== undefined) {
		const problem = store.setCredential(providerId, choice.account.id, credential);
		if (problem !== undefined) {
			ctx.ui.notify(`${NAME}: ${problem}`, "error");
			return;
		}
		store.clearError(providerId, choice.account.id);
		keep(of, ctx, provider, choice.account);
		return;
	}

	// A closed dialog keeps the provider's name.
	let label = provider;
	if (choice !== undefined) label = await askName(ctx, `Name this ${provider} account`, provider);
	const added = saveAccount(ctx, store, providerId, label, credential);
	if (added !== undefined) keep(of, ctx, provider, added);
}

function keep(of: AccountsOf, ctx: ExtensionContext, provider: string, account: Account): void {
	useAccount(of, ctx, account.id);
	ctx.ui.notify(`${NAME}: ${provider} now uses ${account.label}`, "info");
}

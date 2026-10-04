// What happens after a provider login: the credential gets a name, either replacing an account or
// becoming a new one, and the session moves to it.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { pick } from "../ui/picker.ts";
import { activeAccount } from "./active.ts";
import { NAME } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import { refreshStatus } from "./screen.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** Pi's login just produced a credential; ask where it belongs and keep it. */
export async function adoptAccount(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
	credential: Credential,
): Promise<void> {
	if (!ctx.hasUI) return;

	const current = activeAccount(store, pins, providerId)?.id;
	const choices: { account: Account | undefined; label: string }[] = store
		.accounts(providerId)
		.map((account) => ({
			account,
			label: `Replace ${account.label}${account.id === current ? " (in use)" : ""}`,
		}));
	choices.push({ account: undefined, label: "New account" });

	const picked = await pick(
		ctx,
		`Keep this ${providerId} login as`,
		choices.map((choice) => choice.label),
	);
	const choice = choices.find((candidate) => candidate.label === picked);
	if (choice === undefined) return;

	if (choice.account === undefined) {
		const label =
			(await ctx.ui.input(`Name this ${providerId} account`, providerId))?.trim() || providerId;
		const added = store.add(providerId, label, credential);
		if (added.account === undefined) {
			ctx.ui.notify(`${NAME}: ${added.problem}`, "error");
			return;
		}
		keep(scope, store, pins, ctx, providerId, added.account);
		return;
	}

	const problem = store.setCredential(providerId, choice.account.id, credential);
	if (problem !== undefined) {
		ctx.ui.notify(`${NAME}: ${problem}`, "error");
		return;
	}
	store.clearError(providerId, choice.account.id);
	keep(scope, store, pins, ctx, providerId, choice.account);
}

/** Moves the session to the account the login belongs to. */
function keep(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
	account: Account,
): void {
	store.setActive(providerId, account.id);
	pin(scope, pins, providerId, account.id);
	refreshStatus(store, pins, ctx);
	ctx.ui.notify(`${NAME}: ${providerId} now uses ${account.label}`, "info");
}

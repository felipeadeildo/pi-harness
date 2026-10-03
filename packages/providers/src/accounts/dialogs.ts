// The interactive side of the accounts: the picker behind Alt+A and the flow behind /accounts. Both
// draw with our frame, and a host without a terminal falls back to pi's own dialogs.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { pick } from "../ui/picker.ts";
import { activeAccount } from "./active.ts";
import { attachProvider } from "./attach.ts";
import { reason } from "./describe.ts";
import { interactionFor } from "./interaction.ts";
import { login, loginMethods, type LoginMethod } from "./login.ts";
import { LOGIN_KEY, NAME } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import { DEFAULT_ACCOUNT, DEFAULT_LABEL, refreshStatus } from "./screen.ts";
import type { AccountStore } from "./store.ts";

/** Alt+A: the account of the current provider, pinned for the rest of the session. */
export async function pickAccount(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
): Promise<void> {
	if (!ctx.hasUI) {
		scope.warn("no dialog to pick an account");
		return;
	}

	const providerId = ctx.model?.provider;
	if (providerId === undefined) {
		ctx.ui.notify(`${NAME}: no model selected`, "warning");
		return;
	}
	const entries = store.accounts(providerId);
	if (entries.length === 0) {
		ctx.ui.notify(`${NAME}: ${providerId} has no extra account yet`, "info");
		return;
	}

	const current = activeAccount(store, pins, providerId)?.id ?? DEFAULT_ACCOUNT;
	const choices = [
		{ id: DEFAULT_ACCOUNT, label: DEFAULT_LABEL, kind: "login" },
		...entries.map((account) => ({
			id: account.id,
			label: account.label,
			kind: account.credential.type === "oauth" ? "oauth" : "key",
		})),
	];
	const options = choices.map((choice) => {
		const here = choice.id === current ? " ✓" : "";
		return `${choice.label} (${choice.kind})${here}`;
	});

	const picked = await pick(ctx, `Account for ${providerId}`, options);
	const choice = choices[options.indexOf(picked ?? "")];
	if (choice === undefined) return;
	pin(scope, pins, providerId, choice.id === DEFAULT_ACCOUNT ? null : choice.id);
	refreshStatus(store, pins, ctx);
	ctx.ui.notify(`${NAME}: ${providerId} uses ${choice.label}`, "info");
}

/** /accounts: names a new credential and runs the provider's own login. */
export async function addAccount(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	limited: Map<string, Set<string>>,
	args: string,
	ctx: ExtensionContext,
): Promise<void> {
	if (!ctx.hasUI) {
		scope.warn("no dialog to add an account");
		return;
	}

	const providerId = args.trim() || (await pickProvider(ctx));
	if (providerId === undefined) return;
	const provider = ctx.modelRegistry.getProvider(providerId);
	if (provider === undefined) {
		ctx.ui.notify(`${NAME}: no provider "${providerId}"`, "error");
		return;
	}
	const method = await pickMethod(ctx, provider);
	if (method === undefined) return;

	const label =
		(await ctx.ui.input(`Name this ${providerId} account`, providerId))?.trim() || providerId;
	try {
		const credential = await login(
			method,
			interactionFor(ctx, providerId, new AbortController().signal),
		);
		const added = store.add(providerId, label, credential);
		if (added.account === undefined) {
			ctx.ui.notify(`${NAME}: ${added.problem}`, "error");
			return;
		}
		store.setActive(providerId, added.account.id);
		pin(scope, pins, providerId, added.account.id);
		// The first account of a provider was not attached at session start, so attach it now.
		if (store.accounts(providerId).length === 1) {
			attachProvider(scope, store, pins, limited, ctx, providerId);
		}
		refreshStatus(store, pins, ctx);
		ctx.ui.notify(`${NAME}: ${providerId} account "${label}" added`, "info");
	} catch (error) {
		ctx.ui.notify(`${NAME}: ${reason(error)}`, "error");
	} finally {
		ctx.ui.setStatus(LOGIN_KEY, undefined);
	}
}

async function pickProvider(ctx: ExtensionContext): Promise<string | undefined> {
	const candidates: string[] = [];
	for (const providerId of new Set(ctx.modelRegistry.getAll().map((model) => model.provider))) {
		const provider = ctx.modelRegistry.getProvider(providerId);
		if (provider !== undefined && loginMethods(provider).length > 0) candidates.push(providerId);
	}
	const list = candidates.toSorted();
	if (list.length === 0) {
		ctx.ui.notify(`${NAME}: no provider offers a login`, "warning");
		return undefined;
	}
	if (list.length === 1) return list[0];
	return await pick(ctx, "Provider", list);
}

async function pickMethod(
	ctx: ExtensionContext,
	provider: Provider,
): Promise<LoginMethod | undefined> {
	const methods = loginMethods(provider);
	if (methods.length === 0) {
		ctx.ui.notify(`${NAME}: ${provider.id} has no login method`, "warning");
		return undefined;
	}
	if (methods.length === 1) return methods[0];

	const labels = methods.map((method) => method.label);
	const picked = await pick(ctx, `${provider.id} login`, labels);
	return methods.find((method) => method.label === picked);
}

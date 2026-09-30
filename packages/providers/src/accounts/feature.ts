import { defineFeature, literal, setting } from "@adeildo/pi-kit";
import type { FeatureScope } from "@adeildo/pi-kit";
import type { Credential, Provider } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { interactionFor } from "./interaction.ts";
import { liftProvider, nativeOf, type AccountSession } from "./lift.ts";
import { login, loginMethods, type LoginMethod } from "./login.ts";
import { record, replay, type Pins } from "./pins.ts";
import { AccountStore } from "./store.ts";

const NAME = "pi-providers";
const DEFAULT_LABEL = "pi default";

/** What happens when an account hits the limit of its plan. */
export const WHEN_LIMITED = ["ask", "switch", "stop"] as const;
export type WhenLimited = (typeof WHEN_LIMITED)[number];

export const onLimit = setting<WhenLimited>({
	id: "accounts.onLimit",
	default: "ask",
	decoder: literal(...WHEN_LIMITED),
	ui: {
		section: "Accounts",
		label: "When an account hits its limit",
		description: "Ask me first, switch on its own, or stop and tell me.",
		control: {
			type: "choice",
			options: [
				{ value: "ask", label: "ask me first" },
				{ value: "switch", label: "switch on its own" },
				{ value: "stop", label: "stop and tell me" },
			],
		},
	},
});

export const accounts = defineFeature({
	id: "accounts",
	description: "Use more than one credential of the same provider",
	tab: "Providers",
	settings: [onLimit],
	setup(scope) {
		const store = new AccountStore();
		const pins: Pins = new Map();

		scope.onSessionStart((ctx) => {
			for (const warning of store.reload()) scope.warn(warning);
			pins.clear();
			for (const [provider, account] of replay(ctx.sessionManager.getBranch())) {
				pins.set(provider, account);
			}
			for (const providerId of new Set([...store.providerIds(), ...pins.keys()])) {
				lift(scope, store, pins, ctx, providerId);
			}
		});

		scope.registerShortcut(Key.alt("a"), {
			description: `${NAME}: pick the account of the current provider`,
			handler: (ctx) => pickAccount(scope, store, pins, ctx),
		});

		scope.registerCommand("accounts", {
			description: `${NAME}: add an account for a provider`,
			handler: (args, ctx) => addAccount(scope, store, pins, args, ctx),
		});
	},
});

/** The credential the next request uses: the session pin, or the store's default. */
export function credentialOf(
	store: AccountStore,
	pins: Pins,
	providerId: string,
): Credential | undefined {
	if (pins.has(providerId)) {
		const id = pins.get(providerId);
		if (id === null || id === undefined) return undefined;
		return store.accounts(providerId).find((account) => account.id === id)?.credential;
	}
	return store.active(providerId)?.credential;
}

function sessionFor(store: AccountStore, pins: Pins, providerId: string): AccountSession {
	return {
		credential: () => credentialOf(store, pins, providerId),
		saveCredential: (credential) => {
			const pinned = pins.has(providerId) ? pins.get(providerId) : store.active(providerId)?.id;
			if (pinned !== undefined && pinned !== null) {
				void store.setCredential(providerId, pinned, credential);
			}
		},
	};
}

function lift(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
): void {
	// `getProvider` returns the lifted provider once we registered one, so unwrap it before wrapping
	// again. After a `/reload` it returns the built-in one, which is unwrapped too.
	const provider = ctx.modelRegistry.getProvider(providerId);
	if (provider === undefined) {
		scope.warn(`no provider "${providerId}", so its accounts do nothing`);
		return;
	}
	scope.registerProvider(liftProvider(nativeOf(provider), sessionFor(store, pins, providerId)));
}

function pin(scope: FeatureScope, pins: Pins, providerId: string, accountId: string | null): void {
	pins.set(providerId, accountId);
	record(
		scope,
		accountId === null
			? { kind: "default", provider: providerId }
			: { kind: "account", provider: providerId, account: accountId },
	);
}

async function pickAccount(
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

	const options = [
		DEFAULT_LABEL,
		...entries.map((account, index) => `${index + 1}. ${account.label}`),
	];
	const picked = await ctx.ui.select(`${providerId} account`, options);
	const index = picked === undefined ? -1 : options.indexOf(picked);
	if (index < 0) return;

	const accountId = index === 0 ? null : (entries[index - 1]?.id ?? null);
	pin(scope, pins, providerId, accountId);
	const label = index === 0 ? DEFAULT_LABEL : entries[index - 1]?.label;
	ctx.ui.notify(`${NAME}: ${providerId} uses ${label}`, "info");
}

async function addAccount(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
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
		const problem = store.add(providerId, label, credential);
		if (problem !== undefined) {
			ctx.ui.notify(`${NAME}: ${problem}`, "error");
			return;
		}
		const added = store.accounts(providerId).at(-1);
		if (added !== undefined) pin(scope, pins, providerId, added.id);
		// The first account of a provider was not lifted at session start, so lift it now.
		lift(scope, store, pins, ctx, providerId);
		ctx.ui.notify(`${NAME}: ${providerId} account "${label}" added`, "info");
	} catch (error) {
		ctx.ui.notify(`${NAME}: ${reason(error)}`, "error");
	} finally {
		ctx.ui.setStatus("pi-providers:accounts", undefined);
	}
}

async function pickProvider(ctx: ExtensionContext): Promise<string | undefined> {
	const candidates = new Set<string>();
	for (const model of ctx.modelRegistry.getAll()) {
		const provider = ctx.modelRegistry.getProvider(model.provider);
		if (provider !== undefined && loginMethods(provider).length > 0) {
			candidates.add(model.provider);
		}
	}
	const list = [...candidates].toSorted();
	if (list.length === 0) {
		ctx.ui.notify(`${NAME}: no provider offers a login`, "warning");
		return undefined;
	}
	if (list.length === 1) return list[0];
	return await ctx.ui.select("Provider", list);
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
	const picked = await ctx.ui.select(`${provider.id} login`, labels);
	return methods.find((method) => method.label === picked);
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

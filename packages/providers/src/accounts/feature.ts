import { defineFeature, literal, setting } from "@adeildo/pi-kit";
import type { FeatureScope } from "@adeildo/pi-kit";
import type { Credential, Provider } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { activeAccount } from "./active.ts";
import { reason } from "./describe.ts";
import { interactionFor } from "./interaction.ts";
import { liftProvider, nativeOf, type AccountSession } from "./lift.ts";
import { login, loginMethods, type LoginMethod } from "./login.ts";
import { LOGIN_KEY, NAME, STATUS_KEY } from "./names.ts";
import { pin, replay, type Pins } from "./pins.ts";
import { accountRows, DEFAULT_ACCOUNT, DEFAULT_LABEL, refreshStatus } from "./screen.ts";
import { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

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

		scope.screen.rows((ctx) => accountRows(scope, store, pins, ctx));
		scope.on("model_select", (_event, ctx) => refreshStatus(store, pins, ctx));
		scope.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));

		scope.onSessionStart((ctx) => {
			for (const warning of store.reload()) scope.warn(warning);
			pins.clear();
			for (const [provider, account] of replay(ctx.sessionManager.getBranch())) {
				pins.set(provider, account);
			}
			for (const providerId of new Set([...store.providerIds(), ...pins.keys()])) {
				lift(scope, store, pins, ctx, providerId);
			}
			refreshStatus(store, pins, ctx);
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

function sessionFor(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
): AccountSession {
	return {
		resolve: () => {
			const account = activeAccount(store, pins, providerId);
			return account === undefined ? undefined : { id: account.id, credential: account.credential };
		},
		save: (id, credential) => void store.setCredential(providerId, id, credential),
		afterLimit: (currentId, detail) =>
			afterLimit(scope, store, pins, ctx, providerId, currentId, detail),
	};
}

/** Follows the `accounts.onLimit` policy: ask, switch, or stop, and pins the account it moves to. */
export async function afterLimit(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
	currentId: string,
	detail: string,
): Promise<{ id: string; credential: Credential } | undefined> {
	const mode = onLimit.get(scope);
	if (mode === "stop") return undefined;

	const next = nextAccount(store.accounts(providerId), currentId);
	if (next === undefined) return undefined;

	if (mode === "ask") {
		const once = `Switch to ${next.label}`;
		const always = "Always switch when an account hits its limit";
		const picked = await ctx.ui.select(`"${currentId}" hit its limit`, [once, always, "Stop here"]);
		if (picked === always) scope.settings.set(onLimit, "switch");
		else if (picked !== once) return undefined;
	}

	pin(scope, pins, providerId, next.id);
	refreshStatus(store, pins, ctx);
	ctx.ui.notify(`${NAME}: ${providerId} now uses ${next.label} (${detail})`, "warning");
	return { id: next.id, credential: next.credential };
}

/** The account after this one in the list, so a limit moves on instead of repeating. */
function nextAccount(list: readonly Account[], currentId: string): Account | undefined {
	if (list.length < 2) return undefined;
	const index = list.findIndex((account) => account.id === currentId);
	return list[(index + 1) % list.length];
}

function lift(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
): void {
	// A pin with no account left behind it injects nothing, so re-registering it would only cost a
	// model-registry rebuild.
	if (!store.has(providerId)) return;

	// `getProvider` returns the lifted provider once we registered one, so unwrap it before wrapping
	// again. After a `/reload` it returns the built-in one, which is unwrapped too.
	const provider = ctx.modelRegistry.getProvider(providerId);
	if (provider === undefined) {
		scope.warn(`no provider "${providerId}", so its accounts do nothing`);
		return;
	}
	scope.registerProvider(
		liftProvider(nativeOf(provider), sessionFor(scope, store, pins, ctx, providerId)),
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

	const current = activeAccount(store, pins, providerId)?.id ?? DEFAULT_ACCOUNT;
	const choices = [
		{ id: DEFAULT_ACCOUNT, label: DEFAULT_LABEL, kind: "login" },
		...entries.map((account) => ({
			id: account.id,
			label: account.label,
			kind: account.credential.type === "oauth" ? "oauth" : "key",
		})),
	];
	const options = choices.map((choice, index) => {
		const here = choice.id === current ? " ✓" : "";
		return `${index + 1}  ${choice.label} · ${choice.kind}${here}`;
	});

	const picked = await ctx.ui.select(`Account for ${providerId}`, options);
	const index = picked === undefined ? -1 : options.indexOf(picked);
	if (index < 0) return;

	const choice = choices[index];
	if (choice === undefined) return;
	pin(scope, pins, providerId, choice.id === DEFAULT_ACCOUNT ? null : choice.id);
	refreshStatus(store, pins, ctx);
	ctx.ui.notify(`${NAME}: ${providerId} uses ${choice.label}`, "info");
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
		const added = store.add(providerId, label, credential);
		if (added.account === undefined) {
			ctx.ui.notify(`${NAME}: ${added.problem}`, "error");
			return;
		}
		store.setActive(providerId, added.account.id);
		pin(scope, pins, providerId, added.account.id);
		// The first account of a provider was not lifted at session start, so lift it now.
		if (store.accounts(providerId).length === 1) lift(scope, store, pins, ctx, providerId);
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

// The accounts feature and its two entry points.
import { ACCOUNT_STATE, type AccountState, defineFeature, isObject } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { claudeCodeVersion } from "../subscription/feature.ts";
import { anthropicQuota } from "../usage/anthropic.ts";
import { Quota } from "../usage/quota.ts";
import { resetIn, windowsOf } from "../usage/read.ts";
import { activeAccount } from "./active.ts";
import { attachProvider, knownReading, readingFor, type Watch } from "./attach.ts";
import { addAccount, pickAccount } from "./dialogs.ts";
import { NAME, STATUS_KEY } from "./names.ts";
import { replay, type Pins } from "./pins.ts";
import { usageLimitLine } from "./policy.ts";
import { accountRows, DEFAULT_ACCOUNT, DEFAULT_LABEL, refreshStatus } from "./screen.ts";
import { onAuthFailure, onLimit } from "./settings.ts";
import { AccountStore } from "./store.ts";

export const accounts = defineFeature({
	id: "accounts",
	description: "Use more than one credential of the same provider",
	tab: "Providers",
	settings: [onLimit, onAuthFailure],
	setup(scope) {
		const store = new AccountStore();
		const pins: Pins = new Map();
		const watch: Watch = {
			limited: new Map(),
			usage: new Map(),
			quota: new Quota({
				anthropic: anthropicQuota(() =>
					scope.has("subscription") ? claudeCodeVersion.get(scope) : claudeCodeVersion.default,
				),
			}),
		};

		scope.screen.rows((ctx) => accountRows(scope, store, pins, ctx));
		scope.on("model_select", (_event, ctx) => refreshStatus(store, pins, ctx));
		scope.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));

		// Whoever draws the account in use asks for it on the spot, so it is never a frame old.
		scope.events.on(ACCOUNT_STATE, (data: unknown) => {
			if (!isObject(data) || typeof data.provider !== "string") return;
			data.state = inUse(watch, store, pins, data.provider);
		});

		// The line stops pi's own retry.
		scope.on("message_end", (event) => {
			if (event.message.role !== "assistant") return;
			const providerId = event.message.provider;
			if (!store.has(providerId)) return;
			const account = activeAccount(store, pins, providerId);
			const note =
				account === undefined ? undefined : resetIn(knownReading(watch, providerId, account.id));
			const text = usageLimitLine(event.message, account?.label, note);
			if (text === undefined) return;
			return { message: { ...event.message, errorMessage: text } };
		});

		scope.onSessionStart((ctx) => {
			for (const warning of store.reload()) scope.warn(warning);
			pins.clear();
			watch.limited.clear();
			watch.usage.clear();
			for (const [provider, account] of replay(ctx.sessionManager.getBranch())) {
				pins.set(provider, account);
			}
			for (const providerId of new Set([...store.providerIds(), ...pins.keys()])) {
				attachProvider(scope, store, pins, watch, ctx, providerId);
			}
			refreshStatus(store, pins, ctx);
			void readPlans(store, watch, ctx).then(() => refreshStatus(store, pins, ctx));
		});

		scope.registerShortcut(Key.alt("a"), {
			description: `${NAME}: pick the account of the current provider`,
			handler: (ctx) => pickAccount(scope, store, pins, watch, ctx),
		});

		scope.registerCommand("accounts", {
			description: `${NAME}: add an account for a provider`,
			handler: (args, ctx) => addAccount(scope, store, pins, watch, args, ctx),
		});
	},
});

/** Reads the plans in the background, so the footer and the picker find their quota ready. */
async function readPlans(store: AccountStore, watch: Watch, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;
	const providerId = ctx.model?.provider;
	if (providerId === undefined || !store.has(providerId)) return;
	const ids = [DEFAULT_ACCOUNT, ...store.accounts(providerId).map((account) => account.id)];
	await Promise.all(ids.map((id) => readingFor(watch, store, providerId, id)));
}

/** The account in use for a provider, with the windows it is spending. */
function inUse(
	watch: Watch,
	store: AccountStore,
	pins: Pins,
	providerId: string,
): AccountState | undefined {
	if (!store.has(providerId)) return undefined;
	const account = activeAccount(store, pins, providerId);
	const accountId = account?.id ?? DEFAULT_ACCOUNT;
	return {
		provider: providerId,
		label: account?.label ?? DEFAULT_LABEL,
		windows: windowsOf(knownReading(watch, providerId, accountId)),
	};
}

// The accounts feature and its two entry points.
import { defineFeature } from "@adeildo/pi-kit";
import { Key } from "@earendil-works/pi-tui";

import { claudeCodeVersion } from "../subscription/feature.ts";
import { Quota, resetNote, usageOf } from "../usage.ts";
import { activeAccount } from "./active.ts";
import { attachProvider, type Watch } from "./attach.ts";
import { addAccount, pickAccount } from "./dialogs.ts";
import { NAME, STATUS_KEY } from "./names.ts";
import { replay, type Pins } from "./pins.ts";
import { usageLimitLine } from "./policy.ts";
import { accountRows, refreshStatus } from "./screen.ts";
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
			quota: new Quota(() => claudeCodeVersion.get(scope)),
		};

		scope.screen.rows((ctx) => accountRows(scope, store, pins, ctx));
		scope.on("model_select", (_event, ctx) => refreshStatus(store, pins, ctx));
		scope.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));

		// The line stops pi's own retry.
		scope.on("message_end", (event) => {
			if (event.message.role !== "assistant") return;
			const providerId = event.message.provider;
			if (!store.has(providerId)) return;
			const account = activeAccount(store, pins, providerId);
			const note =
				account === undefined ? undefined : resetNote(usageOf(watch.usage, providerId, account.id));
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

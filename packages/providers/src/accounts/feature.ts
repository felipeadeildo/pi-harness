// The accounts feature: it attaches every provider that has accounts to the session, publishes the
// account in use, and routes the two entries, the shortcut and the command.
import { defineFeature } from "@adeildo/pi-kit";
import { Key } from "@earendil-works/pi-tui";

import { activeAccount } from "./active.ts";
import { attachProvider } from "./attach.ts";
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
		const limited = new Map<string, Set<string>>();

		scope.screen.rows((ctx) => accountRows(scope, store, pins, ctx));
		scope.on("model_select", (_event, ctx) => refreshStatus(store, pins, ctx));
		scope.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));

		// A usage limit is terminal for this set of accounts, so the line stops pi's own retry.
		scope.on("message_end", (event) => {
			if (event.message.role !== "assistant") return;
			const providerId = event.message.provider;
			if (!store.has(providerId)) return;
			const text = usageLimitLine(event.message, activeAccount(store, pins, providerId)?.label);
			if (text === undefined) return;
			return { message: { ...event.message, errorMessage: text } };
		});

		scope.onSessionStart((ctx) => {
			for (const warning of store.reload()) scope.warn(warning);
			pins.clear();
			limited.clear();
			for (const [provider, account] of replay(ctx.sessionManager.getBranch())) {
				pins.set(provider, account);
			}
			for (const providerId of new Set([...store.providerIds(), ...pins.keys()])) {
				attachProvider(scope, store, pins, limited, ctx, providerId);
			}
			refreshStatus(store, pins, ctx);
		});

		scope.registerShortcut(Key.alt("a"), {
			description: `${NAME}: pick the account of the current provider`,
			handler: (ctx) => pickAccount(scope, store, pins, ctx),
		});

		scope.registerCommand("accounts", {
			description: `${NAME}: add an account for a provider`,
			handler: (args, ctx) => addAccount(scope, store, pins, limited, args, ctx),
		});
	},
});

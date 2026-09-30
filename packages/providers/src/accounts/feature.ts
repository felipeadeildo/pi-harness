import { defineFeature, literal, setting } from "@adeildo/pi-kit";
import type { Provider } from "@earendil-works/pi-ai";

import { liftProvider, nativeOf, type AccountSession } from "./lift.ts";
import { AccountStore } from "./store.ts";

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
		const native = new Map<string, Provider>();

		scope.onSessionStart((ctx) => {
			for (const warning of store.reload()) scope.warn(warning);
			for (const providerId of store.providerIds()) {
				const current = native.get(providerId) ?? ctx.modelRegistry.getProvider(providerId);
				if (current === undefined) {
					scope.warn(`no provider "${providerId}", so its accounts do nothing`);
					continue;
				}
				const base = nativeOf(current);
				native.set(providerId, base);
				scope.registerProvider(liftProvider(base, session(store, providerId)));
			}
		});
	},
});

/** The credential the next request uses, and where a refreshed one lands. */
function session(store: AccountStore, providerId: string): AccountSession {
	return {
		credential: () => store.active(providerId)?.credential,
		saveCredential: (credential) => {
			const account = store.active(providerId);
			if (account !== undefined) void store.setCredential(providerId, account.id, credential);
		},
	};
}

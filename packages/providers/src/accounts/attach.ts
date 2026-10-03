// Joining a provider to the session: the session answers which account a request uses, where a
// refreshed token goes, and what quota each account reported. The provider is re-registered once, so
// one provider keeps one model list.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type AccountUsage, noteUsage, resetNote, type UsageMap, usageOf } from "../usage.ts";
import { activeAccount } from "./active.ts";
import { liftProvider, nativeOf, type AccountSession } from "./lift.ts";
import type { Pins } from "./pins.ts";
import { afterAuthFailure, afterLimit } from "./policy.ts";
import type { AccountStore } from "./store.ts";

/** What the session learns while it runs: the accounts that refused, and the quota they reported. */
export interface Watch {
	limited: Map<string, Set<string>>;
	usage: UsageMap;
}

export function attachProvider(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	watch: Watch,
	ctx: ExtensionContext,
	providerId: string,
): void {
	// A pin with no account left behind it injects nothing, so re-registering would only cost a
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
		liftProvider(nativeOf(provider), sessionFor(scope, store, pins, watch, ctx, providerId)),
	);
}

function sessionFor(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	watch: Watch,
	ctx: ExtensionContext,
	providerId: string,
): AccountSession {
	return {
		resolve: () => {
			const account = activeAccount(store, pins, providerId);
			return account === undefined ? undefined : { id: account.id, credential: account.credential };
		},
		save: (id, credential) => void store.setCredential(providerId, id, credential),
		served: (id) => void watch.limited.get(providerId)?.delete(id),
		noteUsage: (id, headers) => noteUsage(watch.usage, providerId, id, headers),
		afterLimit: (currentId, detail) =>
			afterLimit(
				scope,
				store,
				pins,
				ctx,
				providerId,
				currentId,
				withReset(detail, usageOf(watch.usage, providerId, currentId)),
				watch.limited,
			),
		afterAuthFailure: (currentId, detail) =>
			afterAuthFailure(scope, store, pins, ctx, providerId, currentId, detail),
	};
}

/** The detail a policy shows, with the reset when the account's window is known. */
function withReset(detail: string, usage: AccountUsage | undefined): string {
	const note = resetNote(usage);
	return note === undefined ? detail : `${detail} · ${note}`;
}

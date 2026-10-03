// What the accounts do when the provider refuses a request: the policy after a usage limit, and the
// policy after a credential the provider will not take. The settings pick the policy; this file
// applies it and keeps the session pointed at the account that answers.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { classifyFailure } from "../errors.ts";
import { pick } from "../ui/picker.ts";
import { reason } from "./describe.ts";
import { interactionFor } from "./interaction.ts";
import { login, loginMethods } from "./login.ts";
import { LOGIN_KEY, NAME } from "./names.ts";
import { pin, type Pins } from "./pins.ts";
import { DEFAULT_LABEL, refreshStatus } from "./screen.ts";
import { onAuthFailure, onLimit } from "./settings.ts";
import type { AccountStore } from "./store.ts";
import type { Account } from "./types.ts";

/** The line that replaces a usage limit on its way out, or undefined when the error is not one. */
export function usageLimitLine(
	message: { provider: string; stopReason?: string; errorMessage?: string },
	label: string | undefined,
	note?: string,
): string | undefined {
	if (message.stopReason !== "error" || message.errorMessage === undefined) return undefined;
	if (classifyFailure(message.errorMessage, message.provider).kind !== "usage") return undefined;
	// The marker is what stops pi's own retry, which would back off for hours against a window that
	// only resets at the provider.
	const who = label === undefined ? message.provider : `${message.provider} · ${label}`;
	const when = note === undefined ? "" : `, ${note}`;
	return `${who}: usage limit reached${when} (quota exceeded)`;
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
	limited: Map<string, Set<string>> = new Map(),
): Promise<{ id: string; credential: Credential } | undefined> {
	const refused = markLimited(limited, providerId, currentId);
	const mode = onLimit.get(scope);
	if (mode === "stop") return undefined;

	const next = nextAccount(store.accounts(providerId), currentId, refused);
	if (next === undefined) return undefined;

	if (mode === "ask") {
		const current = store.accounts(providerId).find((entry) => entry.id === currentId);
		const switchNow = `Switch to ${next.label}`;
		const always = "Always switch when an account hits its limit";
		const picked = await pick(ctx, `"${current?.label ?? DEFAULT_LABEL}" hit its limit`, [
			switchNow,
			always,
			"Stop here",
		]);
		if (picked === always) scope.settings.set(onLimit, "switch");
		else if (picked !== switchNow) return undefined;
	}

	return switchTo(scope, store, pins, ctx, providerId, next, detail);
}

/** Follows the `accounts.onAuthFailure` policy: sign in again, switch, or stop. */
export async function afterAuthFailure(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
	currentId: string,
	detail: string,
): Promise<{ id: string; credential: Credential } | undefined> {
	const mode = onAuthFailure.get(scope);
	if (mode === "stop") return undefined;

	const account = store.accounts(providerId).find((entry) => entry.id === currentId);
	const next = nextAccount(store.accounts(providerId), currentId, new Set());
	if (mode === "switch") {
		return next === undefined
			? undefined
			: switchTo(scope, store, pins, ctx, providerId, next, detail);
	}

	const again = account === undefined ? undefined : `Sign in to ${account.label} again`;
	const other = next === undefined ? undefined : `Switch to ${next.label}`;
	const options: string[] = [];
	if (again !== undefined) options.push(again);
	if (other !== undefined) options.push(other);
	options.push("Stop here");
	if (options.length === 1) return undefined;

	const title =
		account === undefined
			? `${providerId} refused the login`
			: `${providerId} refused the login of "${account.label}"`;
	const picked = await pick(ctx, title, options);
	if (picked === again && account !== undefined) {
		return await signInAgain(store, ctx, providerId, account, detail);
	}
	if (picked === other && next !== undefined) {
		return switchTo(scope, store, pins, ctx, providerId, next, detail);
	}
	return undefined;
}

/** Runs the provider's own login again, keeping the account's name and its pin. */
async function signInAgain(
	store: AccountStore,
	ctx: ExtensionContext,
	providerId: string,
	account: Account,
	detail: string,
): Promise<{ id: string; credential: Credential } | undefined> {
	const provider = ctx.modelRegistry.getProvider(providerId);
	if (provider === undefined) return undefined;
	const method = loginMethods(provider).find(
		(candidate) => candidate.authType === account.credential.type,
	);
	if (method === undefined) {
		ctx.ui.notify(`${NAME}: ${providerId} has no login for this account`, "warning");
		return undefined;
	}
	try {
		const credential = await login(
			method,
			interactionFor(ctx, `${providerId} · ${account.label}`, new AbortController().signal),
		);
		const problem = store.setCredential(providerId, account.id, credential);
		if (problem !== undefined) {
			ctx.ui.notify(`${NAME}: ${problem}`, "error");
			return undefined;
		}
		ctx.ui.notify(`${NAME}: ${providerId} · ${account.label} signed in again (${detail})`, "info");
		return { id: account.id, credential };
	} catch (error) {
		ctx.ui.notify(`${NAME}: ${reason(error)}`, "error");
		return undefined;
	} finally {
		ctx.ui.setStatus(LOGIN_KEY, undefined);
	}
}

/** Pins the account a policy moved to, and tells the session what happened. */
function switchTo(
	scope: FeatureScope,
	store: AccountStore,
	pins: Pins,
	ctx: ExtensionContext,
	providerId: string,
	next: Account,
	detail: string,
): { id: string; credential: Credential } {
	pin(scope, pins, providerId, next.id);
	refreshStatus(store, pins, ctx);
	ctx.ui.notify(`${NAME}: ${providerId} now uses ${next.label} (${detail})`, "warning");
	return { id: next.id, credential: next.credential };
}

/** Remembers the accounts that refused in this session, so a switch does not try them again. */
function markLimited(
	limited: Map<string, Set<string>>,
	providerId: string,
	accountId: string,
): Set<string> {
	const refused = limited.get(providerId) ?? new Set<string>();
	refused.add(accountId);
	limited.set(providerId, refused);
	return refused;
}

/** The account after this one that has not refused yet, so a limit moves on instead of repeating. */
function nextAccount(
	list: readonly Account[],
	currentId: string,
	refused: ReadonlySet<string>,
): Account | undefined {
	if (list.length === 0) return undefined;
	const index = list.findIndex((account) => account.id === currentId);
	// Pi's own credential is not in the list, so every account is a candidate after it.
	if (index < 0) return list.find((account) => !refused.has(account.id));
	if (list.length < 2) return undefined;
	for (let step = 1; step < list.length; step++) {
		const candidate = list[(index + step) % list.length];
		if (candidate !== undefined && !refused.has(candidate.id)) return candidate;
	}
	return undefined;
}

import { expect, test } from "bun:test";

import {
	createAssistantMessageEventStream,
	type Api,
	type Credential,
	type Model,
	type Provider,
	type StreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

import { liftProvider, nativeOf, type AccountSession } from "../src/accounts/lift.ts";

const MODEL = {
	provider: "anthropic",
	id: "claude",
	api: "anthropic-messages",
	name: "Claude",
} as unknown as Model<Api>;

interface Fake {
	provider: Provider;
	seen: StreamOptions[];
	refreshes(): number;
	refreshedWith: AbortSignal[];
}

function fake(): Fake {
	const seen: StreamOptions[] = [];
	const state = { refreshes: 0 };
	const refreshedWith: AbortSignal[] = [];
	const provider: Provider = {
		id: "anthropic",
		name: "Anthropic",
		auth: {
			apiKey: {
				name: "Anthropic API key",
				login: async () => ({ type: "api_key", key: "typed" }),
				check: async () => undefined,
				resolve: async () => undefined,
			},
			oauth: {
				name: "Claude Pro/Max",
				login: async () => ({ type: "oauth", access: "a", refresh: "r", expires: Date.now() }),
				refresh: async (credential, signal) => {
					state.refreshes += 1;
					refreshedWith.push(signal);
					return { ...credential, access: "refreshed", expires: Date.now() + 3_600_000 };
				},
				toAuth: async (credential) => ({ apiKey: `oauth:${credential.access}` }),
			},
		},
		getModels: () => [],
		stream: (_model, _context, options) => {
			seen.push(options ?? {});
			return createAssistantMessageEventStream();
		},
		streamSimple: (_model, _context, options) => {
			seen.push(options ?? {});
			return createAssistantMessageEventStream();
		},
	};
	return {
		provider,
		seen,
		refreshes: () => state.refreshes,
		refreshedWith,
	};
}

function session(
	credential: Credential | undefined,
): AccountSession & { saved: { id: string; credential: Credential }[] } {
	const saved: { id: string; credential: Credential }[] = [];
	return {
		saved,
		resolve: () => (credential === undefined ? undefined : { id: ACCOUNT_ID, credential }),
		save: (id, next) => void saved.push({ id, credential: next }),
	};
}

/** `lazyStream` runs its setup on the microtask queue, so the request options land after a tick. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const CONTEXT = { messages: [] } as unknown as TranscriptContext;
const ACCOUNT_ID = "acct";

test("an OAuth account replaces the api key of the request", async () => {
	const { provider, seen } = fake();
	const account: Credential = {
		type: "oauth",
		access: "work",
		refresh: "r",
		expires: Date.now() + 3_600_000,
	};
	const lifted = liftProvider(provider, session(account));

	lifted.streamSimple(MODEL, CONTEXT, { apiKey: "native" });
	await settle();

	expect(seen[0]?.apiKey).toBe("oauth:work");
});

test("an api key account brings its env, and its headers win", async () => {
	const { provider, seen } = fake();
	const withKey: Provider = {
		...provider,
		auth: {
			apiKey: {
				name: "key",
				resolve: async () => ({
					auth: { apiKey: "typed", headers: { "x-account": "b" } },
					env: { REGION: "us" },
				}),
			},
		},
	};
	const account: Credential = { type: "api_key", key: "typed" };
	const lifted = liftProvider(withKey, session(account));

	lifted.streamSimple(MODEL, CONTEXT, { headers: { "x-account": "a", keep: "1" } });
	await settle();

	expect(seen[0]?.apiKey).toBe("typed");
	expect(seen[0]?.env).toEqual({ REGION: "us" });
	expect(seen[0]?.headers).toEqual({ "x-account": "b", keep: "1" });
});

test("an expired token is refreshed once and saved, with the request's signal", async () => {
	const { provider, seen, refreshes, refreshedWith } = fake();
	const account: Credential = { type: "oauth", access: "old", refresh: "r", expires: 0 };
	const state = session(account);
	const lifted = liftProvider(provider, state);
	const signal = new AbortController().signal;

	lifted.streamSimple(MODEL, CONTEXT, { signal });
	await settle();

	expect(refreshes()).toBe(1);
	expect(refreshedWith[0]).toBe(signal);
	expect(state.saved).toHaveLength(1);
	expect(state.saved[0]?.id).toBe(ACCOUNT_ID);
	expect(state.saved[0]?.credential).toMatchObject({ access: "refreshed" });
	expect(seen[0]?.apiKey).toBe("oauth:refreshed");
});

test("two requests share one refresh of an expired token", async () => {
	const { provider, refreshes } = fake();
	const account: Credential = { type: "oauth", access: "old", refresh: "r", expires: 0 };
	const lifted = liftProvider(provider, session(account));

	lifted.streamSimple(MODEL, CONTEXT);
	lifted.streamSimple(MODEL, CONTEXT);
	await settle();

	expect(refreshes()).toBe(1);
});

test("without an account the native request goes through untouched", async () => {
	const { provider, seen, refreshes } = fake();
	const lifted = liftProvider(provider, session(undefined));

	lifted.streamSimple(MODEL, CONTEXT, { apiKey: "native" });
	await settle();

	expect(refreshes()).toBe(0);
	expect(seen[0]?.apiKey).toBe("native");
});

test("the provider reports configured while an account exists", async () => {
	const { provider } = fake();
	const withAccount = liftProvider(
		provider,
		session({ type: "oauth", access: "a", refresh: "r", expires: 0 }),
	);
	const without = liftProvider(provider, session(undefined));

	expect(
		await withAccount.auth.apiKey?.check?.({
			ctx: { env: async () => undefined, fileExists: async () => false },
			signal: new AbortController().signal,
		}),
	).toMatchObject({
		type: "oauth",
	});
	expect(
		await without.auth.apiKey?.check?.({
			ctx: { env: async () => undefined, fileExists: async () => false },
			signal: new AbortController().signal,
		}),
	).toBeUndefined();
});

test("lifting twice wraps the same native provider", () => {
	const { provider } = fake();
	const once = liftProvider(provider, session(undefined));
	const twice = liftProvider(nativeOf(once), session(undefined));

	expect(nativeOf(twice)).toBe(provider);
});

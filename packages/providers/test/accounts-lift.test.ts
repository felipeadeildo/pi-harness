import { expect, test } from "bun:test";

import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
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
		afterLimit: async () => undefined,
	};
}

/** `lazyStream` runs its setup on the microtask queue, so the request options land after a tick. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const CONTEXT = { messages: [] } as unknown as TranscriptContext;
const ACCOUNT_ID = "acct";

function assistant(stopReason: "stop" | "error", errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		...(errorMessage === undefined ? {} : { errorMessage }),
		timestamp: Date.now(),
	};
}

/** Fails with a limit on the first credential, and answers on the second. */
function limitThenAnswer(): Provider {
	let calls = 0;
	return {
		id: "anthropic",
		name: "Anthropic",
		auth: { apiKey: { name: "key", resolve: async () => undefined } },
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => {
			calls += 1;
			const stream = createAssistantMessageEventStream();
			if (calls > 1) {
				stream.push({ type: "start", partial: assistant("stop") });
				stream.push({
					type: "text_delta",
					contentIndex: 0,
					delta: "hi",
					partial: assistant("stop"),
				});
				stream.push({ type: "done", reason: "stop", message: assistant("stop") });
				stream.end(assistant("stop"));
			} else {
				stream.push({ type: "start", partial: assistant("error") });
				stream.push({
					type: "error",
					reason: "error",
					error: assistant("error", "429 rate limit"),
				});
				stream.end(assistant("error", "429 rate limit"));
			}
			return stream;
		},
	};
}

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

test("a limit before any output moves to the next account and answers there", async () => {
	const first: Credential = { type: "api_key", key: "first" };
	const second: Credential = { type: "api_key", key: "second" };
	const asked: string[] = [];
	const lifted = liftProvider(limitThenAnswer(), {
		resolve: () => ({ id: "a", credential: first }),
		save: () => {},
		afterLimit: async (currentId, reason) => {
			asked.push(`${currentId}:${reason}`);
			return { id: "b", credential: second };
		},
	});

	const events: string[] = [];
	for await (const event of lifted.streamSimple(MODEL, CONTEXT)) events.push(event.type);

	expect(asked).toEqual(["a:429 rate limit"]);
	expect(events).toEqual(["start", "text_delta", "done"]);
});

test("a busy server is not a limit, so it surfaces instead of switching", async () => {
	const provider: Provider = {
		id: "anthropic",
		name: "Anthropic",
		auth: { apiKey: { name: "key", resolve: async () => undefined } },
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "start", partial: assistant("error") });
			stream.push({ type: "error", reason: "error", error: assistant("error", "529 overloaded") });
			stream.end(assistant("error", "529 overloaded"));
			return stream;
		},
	};
	let asked = false;
	const lifted = liftProvider(provider, {
		resolve: () => ({ id: "a", credential: { type: "api_key", key: "first" } }),
		save: () => {},
		afterLimit: async () => {
			asked = true;
			return undefined;
		},
	});

	const events: string[] = [];
	for await (const event of lifted.streamSimple(MODEL, CONTEXT)) events.push(event.type);

	expect(asked).toBe(false);
	expect(events).toEqual(["start", "error"]);
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

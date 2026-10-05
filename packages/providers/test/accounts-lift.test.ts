import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Credential,
	type Model,
	type OAuthCredential,
	type Provider,
	type ProviderAuthInteraction,
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

const LIMIT_MESSAGE =
	"This request would exceed your account's rate limit. Please try again later.";
const USAGE_LIMIT = `429 {"type":"error","error":{"type":"rate_limit_error","message":"${LIMIT_MESSAGE}"},"request_id":"req_test"}`;

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

function session(credential: Credential | undefined): AccountSession & {
	saved: { id: string; credential: Credential }[];
	notes: { id: string; headers: Record<string, string> }[];
} {
	const saved: { id: string; credential: Credential }[] = [];
	const notes: { id: string; headers: Record<string, string> }[] = [];
	return {
		saved,
		notes,
		resolve: () => (credential === undefined ? undefined : { id: ACCOUNT_ID, credential }),
		save: (id, next) => void saved.push({ id, credential: next }),
		afterLimit: async () => undefined,
		noteUsage: (id, headers) => void notes.push({ id, headers }),
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
					error: assistant("error", USAGE_LIMIT),
				});
				stream.end(assistant("error", USAGE_LIMIT));
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

	expect(asked).toEqual([`a:${LIMIT_MESSAGE}`]);
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

/** Refuses with `text` on the first call, answering on the second. `how` picks event or throw. */
function refuseThenAnswer(text: string, how: "event" | "throw" = "event"): Provider {
	let calls = 0;
	return {
		id: "anthropic",
		name: "Anthropic",
		auth: { apiKey: { name: "key", resolve: async () => undefined } },
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => {
			calls += 1;
			if (calls === 1 && how === "throw") throw new Error(text);
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
				return stream;
			}
			stream.push({ type: "start", partial: assistant("error") });
			stream.push({ type: "error", reason: "error", error: assistant("error", text) });
			stream.end(assistant("error", text));
			return stream;
		},
	};
}

test("a usage limit that arrives as a throw still moves on", async () => {
	const seen: string[] = [];
	const lifted = liftProvider(refuseThenAnswer(USAGE_LIMIT, "throw"), {
		resolve: () => ({ id: "a", credential: { type: "api_key", key: "first" } }),
		save: () => {},
		afterLimit: async (currentId, detail) => {
			seen.push(`${currentId}:${detail}`);
			return { id: "b", credential: { type: "api_key", key: "second" } };
		},
	});

	const events: string[] = [];
	for await (const event of lifted.streamSimple(MODEL, CONTEXT)) events.push(event.type);

	expect(seen).toEqual([`a:${LIMIT_MESSAGE}`]);
	expect(events).toEqual(["start", "text_delta", "done"]);
});

test("a bare throttle stays on the account and keeps pi's retry", async () => {
	const throttle = `429 {"error":{"message":"Rate limited. Please try again later.","type":"rate_limit_error"}}`;
	let asked = false;
	const lifted = liftProvider(refuseThenAnswer(throttle), {
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

test("a refused credential signs in again on the same account", async () => {
	const refused = `401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`;
	const seen: string[] = [];
	const lifted = liftProvider(refuseThenAnswer(refused), {
		resolve: () => ({ id: "a", credential: { type: "api_key", key: "old" } }),
		save: () => {},
		afterLimit: async () => undefined,
		afterAuthFailure: async (currentId, detail) => {
			seen.push(`${currentId}:${detail}`);
			return { id: currentId, credential: { type: "api_key", key: "new" } };
		},
	});

	const events: string[] = [];
	for await (const event of lifted.streamSimple(MODEL, CONTEXT)) events.push(event.type);

	expect(seen).toEqual(["a:invalid x-api-key"]);
	expect(events).toEqual(["start", "text_delta", "done"]);
});

test("a refresh that fails is an auth failure, not a dead end", async () => {
	const provider: Provider = {
		id: "anthropic",
		name: "Anthropic",
		auth: {
			apiKey: { name: "key", resolve: async () => undefined },
			oauth: {
				name: "Claude Pro/Max",
				login: async () => ({ type: "oauth", access: "new", refresh: "r", expires: Date.now() }),
				refresh: async () => {
					throw new Error(
						`401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has been invalidated"}}`,
					);
				},
				toAuth: async (credential) => ({ apiKey: `oauth:${credential.access}` }),
			},
		},
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "start", partial: assistant("stop") });
			stream.push({
				type: "text_delta",
				contentIndex: 0,
				delta: "hi",
				partial: assistant("stop"),
			});
			stream.push({ type: "done", reason: "stop", message: assistant("stop") });
			stream.end(assistant("stop"));
			return stream;
		},
	};
	const seen: string[] = [];
	const lifted = liftProvider(provider, {
		resolve: () => ({
			id: "a",
			credential: { type: "oauth", access: "old", refresh: "r", expires: 0 },
		}),
		save: () => {},
		afterLimit: async () => undefined,
		afterAuthFailure: async (currentId, detail) => {
			seen.push(`${currentId}:${detail}`);
			return {
				id: currentId,
				credential: {
					type: "oauth",
					access: "fresh",
					refresh: "r",
					expires: Date.now() + 3_600_000,
				},
			};
		},
	});

	const events: string[] = [];
	for await (const event of lifted.streamSimple(MODEL, CONTEXT)) events.push(event.type);

	expect(seen).toEqual(["a:OAuth token has been invalidated"]);
	expect(events).toEqual(["start", "text_delta", "done"]);
});

test("without an account a limit stays the provider's to show", async () => {
	let asked = false;
	const lifted = liftProvider(refuseThenAnswer(USAGE_LIMIT), {
		resolve: () => undefined,
		save: () => {},
		afterLimit: async () => {
			asked = true;
			return { id: "b", credential: { type: "api_key", key: "second" } };
		},
	});

	const events: string[] = [];
	for await (const event of lifted.streamSimple(MODEL, CONTEXT)) events.push(event.type);

	expect(asked).toBe(false);
	expect(events).toEqual(["start", "error"]);
});

test("the headers of a response land on the account that served it", async () => {
	const headers = { "anthropic-ratelimit-unified-5h-utilization": "0.5" };
	const provider: Provider = {
		id: "anthropic",
		name: "Anthropic",
		auth: { apiKey: { name: "key", resolve: async () => undefined } },
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: (_model, _context, options) => {
			void options?.onResponse?.({ status: 200, headers }, MODEL);
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "start", partial: assistant("stop") });
			stream.push({ type: "done", reason: "stop", message: assistant("stop") });
			stream.end(assistant("stop"));
			return stream;
		},
	};
	const state = session({ type: "api_key", key: "k" });
	const lifted = liftProvider(provider, state);

	for await (const event of lifted.streamSimple(MODEL, CONTEXT)) void event;

	expect(state.notes).toEqual([{ id: ACCOUNT_ID, headers }]);
});

test("a login through the lifted provider hands the credential to the feature", async () => {
	const { provider } = fake();
	const adopted: Credential[] = [];
	const lifted = liftProvider(provider, {
		...session(undefined),
		adopt: async (credential) => void adopted.push(credential),
	});
	const interaction: ProviderAuthInteraction = {
		signal: new AbortController().signal,
		prompt: async () => "",
		notify: () => {},
	};

	const credential = await lifted.auth.apiKey?.login?.(interaction);
	if (credential === undefined) throw new Error("no login");

	expect(adopted).toEqual([credential]);
});

test("a credential another pi refreshed is used instead of refreshing again", async () => {
	const { provider, refreshes, seen } = fake();
	const account: Credential = { type: "oauth", access: "old", refresh: "r", expires: 0 };
	const lifted = liftProvider(provider, {
		...session(account),
		freshen: () => ({
			type: "oauth",
			access: "disk",
			refresh: "r",
			expires: Date.now() + 3_600_000,
		}),
	});

	lifted.streamSimple(MODEL, CONTEXT);
	await settle();

	expect(refreshes()).toBe(0);
	expect(seen[0]?.apiKey).toBe("oauth:disk");
});

test("the refresh runs with the shared lock held", async () => {
	const { provider } = fake();
	const lock = join(tmpdir(), `pi-lift-lock-${randomUUID()}.lock`);
	let held = false;
	provider.auth.oauth = {
		...provider.auth.oauth!,
		refresh: async (credential) => {
			held = existsSync(lock);
			return { ...credential, access: "fresh", expires: Date.now() + 3_600_000 };
		},
	};
	const lifted = liftProvider(provider, {
		...session({ type: "oauth", access: "old", refresh: "r", expires: 0 }),
		lockPath: () => lock,
	});

	lifted.streamSimple(MODEL, CONTEXT);
	await settle();

	expect(held).toBe(true);
	expect(existsSync(lock)).toBe(false);
});

test("a login runs on our screen when the session offers one", async () => {
	const { provider } = fake();
	let closed = 0;
	const interaction: ProviderAuthInteraction = {
		signal: new AbortController().signal,
		prompt: async () => "",
		notify: () => {},
	};
	let offered = 0;
	const lifted = liftProvider(provider, {
		...session(undefined),
		adopt: async () => {},
		loginScreen: async () => {
			offered += 1;
			return { interaction, close: () => void (closed += 1) };
		},
	});

	await lifted.auth.apiKey?.login?.(interaction);

	expect(offered).toBe(1);
	expect(closed).toBe(1);
});

const AUTH_INPUT = {
	ctx: { env: async () => undefined, fileExists: async () => false },
	signal: new AbortController().signal,
};
const PI_COPY: OAuthCredential = {
	type: "oauth",
	access: "pi",
	refresh: "pi-refresh",
	expires: 0,
};

test("pi asks for auth and gets the account in use, not what it stored", async () => {
	const { provider } = fake();
	const account: Credential = {
		type: "oauth",
		access: "acct",
		refresh: "r",
		expires: Date.now() + 3_600_000,
	};
	const lifted = liftProvider(provider, session(account));

	expect(await lifted.auth.apiKey?.resolve(AUTH_INPUT)).toEqual({
		auth: { apiKey: "oauth:acct" },
		source: "account",
	});
	expect(await lifted.auth.oauth?.toAuth(PI_COPY)).toEqual({ apiKey: "oauth:acct" });
});

test("pi's expired copy renews the account in use, never pi's own token", async () => {
	const { provider, refreshes } = fake();
	const account: Credential = { type: "oauth", access: "old", refresh: "acct-refresh", expires: 0 };
	const state = session(account);
	const lifted = liftProvider(provider, state);

	const renewed = await lifted.auth.oauth?.refresh(PI_COPY, new AbortController().signal);

	expect(refreshes()).toBe(1);
	// The account's grant was renewed and saved; pi gets that, so its copy follows ours.
	expect(renewed).toMatchObject({ access: "refreshed", refresh: "acct-refresh" });
	expect(state.saved).toEqual([{ id: ACCOUNT_ID, credential: renewed as Credential }]);
});

test("with a key in use, pi's copy is renewed from a subscription account", async () => {
	const { provider } = fake();
	const subscription: Credential = {
		type: "oauth",
		access: "sub",
		refresh: "sub-refresh",
		expires: Date.now() + 3_600_000,
	};
	const lifted = liftProvider(provider, {
		...session({ type: "api_key", key: "k" }),
		subscription: () => ({ id: "sub", credential: subscription }),
	});

	expect(await lifted.auth.oauth?.refresh(PI_COPY, new AbortController().signal)).toEqual(
		subscription,
	);
});

test("once the accounts are gone, pi's own copy answers again", async () => {
	const { provider } = fake();
	const lifted = liftProvider(provider, session(undefined));

	expect(await lifted.auth.oauth?.toAuth(PI_COPY)).toEqual({ apiKey: "oauth:pi" });
	expect(await lifted.auth.apiKey?.resolve(AUTH_INPUT)).toBeUndefined();
});

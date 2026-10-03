import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { fakeContext, fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import {
	createAssistantMessageEventStream,
	type Credential,
	type Provider,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { activeAccount } from "../src/accounts/active.ts";
import { accounts } from "../src/accounts/feature.ts";
import { nativeOf } from "../src/accounts/lift.ts";
import type { Pins } from "../src/accounts/pins.ts";
import { afterAuthFailure, afterLimit, usageLimitLine } from "../src/accounts/policy.ts";
import { onAuthFailure, onLimit } from "../src/accounts/settings.ts";
import { AccountStore } from "../src/accounts/store.ts";
import { agentDirFixture } from "./helpers.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };
const OTHER: Credential = { type: "api_key", key: "k" };
const WINDOW = `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit."}}`;

let dir: string;
let restore: () => void;

beforeEach(() => {
	const fixture = agentDirFixture("pi-accounts-feature-");
	dir = fixture.dir;
	restore = fixture.restore;
});

afterEach(() => restore());

function native(): Provider {
	return {
		id: "anthropic",
		name: "Anthropic",
		auth: { apiKey: { name: "key", resolve: async () => undefined } },
		getModels: () => [],
		stream: () => createAssistantMessageEventStream(),
		streamSimple: () => createAssistantMessageEventStream(),
	};
}

test("a session lifts every provider that has accounts", async () => {
	new AccountStore().add("anthropic", "personal", OAUTH);

	const fake = fakePi();
	const captured: Provider[] = [];
	fake.pi.registerProvider = ((provider: Provider) => void captured.push(provider)) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const provider = native();
	const ctx = fakeContext([], true, {
		modelRegistry: { getProvider: (id: string) => (id === "anthropic" ? provider : undefined) },
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);

	expect(captured).toHaveLength(1);
	expect(nativeOf(captured[0] as Provider)).toBe(provider);
});

test("a provider without accounts is left alone", async () => {
	const fake = fakePi();
	const captured: Provider[] = [];
	fake.pi.registerProvider = ((provider: Provider) => void captured.push(provider)) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const ctx = fakeContext([], true, {
		modelRegistry: { getProvider: () => native() },
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);

	expect(captured).toHaveLength(0);
});

test("adding the first account lifts the provider and pins it", async () => {
	const fake = fakePi();
	const captured: Provider[] = [];
	fake.pi.registerProvider = ((provider: Provider) => void captured.push(provider)) as never;
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const provider = native();
	provider.auth.oauth = {
		name: "Claude Pro/Max",
		login: async () => ({ type: "oauth", access: "a", refresh: "r", expires: 0 }),
		refresh: async (credential) => credential,
		toAuth: async () => ({}),
	};
	const ctx = fakeContext([], true, {
		ui: {
			notify: () => {},
			setStatus: () => {},
			input: async () => "work",
			select: async () => undefined,
		},
		modelRegistry: {
			getProvider: () => provider,
			getAll: () => [{ provider: "anthropic", id: "claude" }],
		},
		sessionManager: { getBranch: () => [] },
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);
	expect(captured).toHaveLength(0);

	const handler = fake.commands.get("accounts")?.handler;
	if (handler === undefined) throw new Error("no accounts command");
	await handler("anthropic", ctx as never);

	expect(new AccountStore().has("anthropic")).toBe(true);
	expect(captured).toHaveLength(1);
	expect(nativeOf(captured[0] as Provider)).toBe(provider);
});

test("the session pin overrides the store default, and null means pi's own credential", () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const work = store.accounts("anthropic").at(-1);
	const pins: Pins = new Map([["anthropic", work?.id ?? ""]]);

	expect(activeAccount(store, pins, "anthropic")?.credential).toEqual(OTHER);
	pins.set("anthropic", null);
	expect(activeAccount(store, pins, "anthropic")?.credential).toBeUndefined();
	pins.delete("anthropic");
	expect(activeAccount(store, pins, "anthropic")?.credential).toBeUndefined();
	store.setActive("anthropic", store.accounts("anthropic")[0]?.id);
	expect(activeAccount(store, pins, "anthropic")?.credential).toEqual(OAUTH);
});

test("after a limit, ask switches and pins, and stop keeps the error", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal, work] = store.accounts("anthropic");
	if (personal === undefined || work === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	const shown: string[] = [];
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				shown.push(...options);
				return options[0];
			},
		},
	});

	const moved = await afterLimit(scope, store, pins, ctx, "anthropic", personal.id, "429");
	expect(moved?.id).toBe(work.id);
	expect(pins.get("anthropic")).toBe(work.id);
	expect(shown[0]).toContain("Switch to work");

	scope.settings.set(onLimit, "stop");
	expect(await afterLimit(scope, store, pins, ctx, "anthropic", work.id, "429")).toBeUndefined();
});

test("asking always turns the policy into switch", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal, work] = store.accounts("anthropic");
	if (personal === undefined || work === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_t: string, options: string[]) => options[1],
		},
	});

	await afterLimit(scope, store, pins, ctx, "anthropic", personal.id, "429");
	expect(onLimit.get(scope)).toBe("switch");
	expect(pins.get("anthropic")).toBe(work.id);
});

test("a second account that refuses in the same session is not asked about again", async () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", OTHER);
	const [personal, work] = store.accounts("anthropic");
	if (personal === undefined || work === undefined) throw new Error("no accounts");
	const pins: Pins = new Map([["anthropic", personal.id]]);
	const limited = new Map<string, Set<string>>();
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onLimit]);
	let asked = 0;
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => {
				asked += 1;
				return options[0];
			},
		},
	});

	const moved = await afterLimit(
		scope,
		store,
		pins,
		ctx,
		"anthropic",
		personal.id,
		"limit",
		limited,
	);
	expect(moved?.id).toBe(work.id);
	expect(asked).toBe(1);

	const exhausted = await afterLimit(
		scope,
		store,
		pins,
		ctx,
		"anthropic",
		work.id,
		"limit",
		limited,
	);
	expect(exhausted).toBeUndefined();
	expect(asked).toBe(1);
});

test("a refused login signs in again without losing the account", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OAUTH);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");
	const pins: Pins = new Map([["anthropic", work.id]]);
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onAuthFailure]);
	const fresh: Credential = { type: "oauth", access: "fresh", refresh: "r2", expires: 0 };
	const provider = native();
	provider.auth.oauth = {
		name: "Claude Pro/Max",
		login: async () => fresh,
		refresh: async (credential) => credential,
		toAuth: async () => ({}),
	};
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => options[0],
		},
		modelRegistry: { getProvider: () => provider },
	});

	const moved = await afterAuthFailure(
		scope,
		store,
		pins,
		ctx,
		"anthropic",
		work.id,
		"invalid_grant",
	);

	expect(moved?.id).toBe(work.id);
	expect(moved?.credential).toEqual(fresh);
	const saved = new AccountStore().accounts("anthropic")[0];
	expect(saved?.label).toBe("work");
	expect(saved?.credential).toEqual(fresh);
});

test("a usage limit gets the line that stops pi's retry", async () => {
	const store = new AccountStore();
	const added = store.add("anthropic", "work", OAUTH);
	store.setActive("anthropic", added.account?.id);

	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(accounts)
		.build();

	const fired = (await fake.fire(
		"message_end",
		{
			type: "message_end",
			message: {
				role: "assistant",
				provider: "anthropic",
				stopReason: "error",
				errorMessage: WINDOW,
			},
		},
		fakeContext([], true, {}),
	)) as Array<{ message?: { errorMessage?: string } } | undefined>;

	expect(fired[0]?.message?.errorMessage).toBe(
		"anthropic · work: usage limit reached (quota exceeded)",
	);
});

test("pi's own login that is refused can still move to a saved account", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OTHER);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");
	const scope = fakeScope({ pi: fakePi() });
	scope.settings.register([onAuthFailure]);
	const ctx = fakeContext([], true, {
		model: { provider: "anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => options[0],
		},
	});

	const moved = await afterAuthFailure(scope, store, new Map(), ctx, "anthropic", "default", "401");

	expect(moved?.id).toBe(work.id);
});

test("the replacement line stops pi's retry with the marker it reads", () => {
	const text = usageLimitLine(
		{ provider: "anthropic", stopReason: "error", errorMessage: WINDOW },
		"work",
	);
	expect(text).toBe("anthropic · work: usage limit reached (quota exceeded)");
	expect(text).toContain("quota exceeded");
});

test("a finished message or another error is left alone", () => {
	expect(usageLimitLine({ provider: "anthropic", stopReason: "stop" }, "work")).toBeUndefined();
	expect(
		usageLimitLine(
			{ provider: "anthropic", stopReason: "error", errorMessage: "500 oops" },
			"work",
		),
	).toBeUndefined();
});

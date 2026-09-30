import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import {
	createAssistantMessageEventStream,
	type Credential,
	type Provider,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { accounts, credentialOf } from "../src/accounts/feature.ts";
import { nativeOf } from "../src/accounts/lift.ts";
import type { Pins } from "../src/accounts/pins.ts";
import { AccountStore } from "../src/accounts/store.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };
const OTHER: Credential = { type: "api_key", key: "k" };

let dir: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.PI_CODING_AGENT_DIR;
	dir = mkdtempSync(join(tmpdir(), "pi-accounts-feature-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});

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

	expect(credentialOf(store, pins, "anthropic")).toEqual(OTHER);
	pins.set("anthropic", null);
	expect(credentialOf(store, pins, "anthropic")).toBeUndefined();
	pins.delete("anthropic");
	expect(credentialOf(store, pins, "anthropic")).toEqual(OAUTH);
});

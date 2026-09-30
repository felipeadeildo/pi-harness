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

import { accounts } from "../src/accounts/feature.ts";
import { nativeOf } from "../src/accounts/lift.ts";
import { AccountStore } from "../src/accounts/store.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };

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
	}) as ExtensionContext;
	await fake.fire("session_start", {}, ctx);

	expect(captured).toHaveLength(0);
});

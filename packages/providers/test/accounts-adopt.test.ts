import { afterEach, beforeEach, expect, test } from "bun:test";

import { fakeContext, fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { adoptAccount } from "../src/accounts/adopt.ts";
import { AccountStore } from "../src/accounts/store.ts";
import { agentDirFixture } from "./helpers.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };
const FRESH: Credential = { type: "oauth", access: "fresh", refresh: "r2", expires: 0 };

let restore: () => void;

beforeEach(() => {
	restore = agentDirFixture("pi-accounts-adopt-").restore;
});

afterEach(() => restore());

function context(
	picked: (options: string[]) => string | undefined,
	name?: string,
): ExtensionContext {
	return fakeContext([], true, {
		modelRegistry: { getProviderDisplayName: () => "Anthropic" },
		ui: {
			setStatus: () => {},
			notify: () => {},
			select: async (_title: string, options: string[]) => picked(options),
			input: async () => name,
		},
	});
}

test("a login replaces the account it belongs to", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OAUTH);
	const [work] = store.accounts("anthropic");
	if (work === undefined) throw new Error("no account");
	const scope = fakeScope({ pi: fakePi() });
	const pins = new Map([["anthropic", work.id]]);

	await adoptAccount(
		scope,
		store,
		pins,
		context((options) => options[0]),
		"anthropic",
		FRESH,
	);

	const saved = new AccountStore().accounts("anthropic")[0];
	expect(saved?.label).toBe("work");
	expect(saved?.credential).toEqual(FRESH);
	expect(new AccountStore().active("anthropic")?.id).toBe(work.id);
});

test("a login can become a new account", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OAUTH);
	const scope = fakeScope({ pi: fakePi() });
	const pins = new Map<string, string>();

	await adoptAccount(
		scope,
		store,
		pins,
		context((options) => options.at(-1), "study"),
		"anthropic",
		FRESH,
	);

	const accounts = new AccountStore().accounts("anthropic");
	expect(accounts.map((account) => account.label)).toEqual(["work", "study"]);
	expect(pins.get("anthropic")).toBe(accounts[1]?.id);
});

test("a closed dialog still keeps the login, under the provider's name", async () => {
	const store = new AccountStore();
	store.add("anthropic", "work", OAUTH);
	const scope = fakeScope({ pi: fakePi() });
	const pins = new Map<string, string>();

	await adoptAccount(
		scope,
		store,
		pins,
		context(() => undefined),
		"anthropic",
		FRESH,
	);

	const accounts = new AccountStore().accounts("anthropic");
	expect(accounts.map((account) => account.label)).toEqual(["work", "Anthropic"]);
	expect(accounts[0]?.credential).toEqual(OAUTH);
	expect(accounts[1]?.credential).toEqual(FRESH);
	expect(pins.get("anthropic")).toBe(accounts[1]?.id);
});

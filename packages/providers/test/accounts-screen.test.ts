import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";

import { fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { SESSION_ENTRY } from "../src/accounts/names.ts";
import type { Pins } from "../src/accounts/pins.ts";
import { accountRows, accountStatus } from "../src/accounts/screen.ts";
import { AccountStore } from "../src/accounts/store.ts";
import { agentDirFixture } from "./helpers.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };
const KEY: Credential = { type: "api_key", key: "k" };
const CTX = {
	model: { provider: "anthropic" },
	ui: { setStatus: () => {} },
	modelRegistry: { getProviderDisplayName: () => "Anthropic" },
} as unknown as ExtensionContext;

let dir: string;
let restore: () => void;

beforeEach(() => {
	const fixture = agentDirFixture("pi-accounts-screen-");
	dir = fixture.dir;
	restore = fixture.restore;
});

afterEach(() => restore());

function setup() {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", KEY);
	const pins: Pins = new Map();
	const fake = fakePi();
	return { store, pins, fake, rows: accountRows(fakeScope({ pi: fake }), store, pins, CTX) };
}

test("the screen reads as a tree per provider", () => {
	const { rows } = setup();
	const ids = rows.map((row) => row.id);

	expect(ids).toContain("accounts.anthropic.default");
	expect(ids.filter((id) => id.endsWith(".use"))).toHaveLength(2);
	expect(ids.filter((id) => id.endsWith(".label"))).toHaveLength(2);
	expect(ids.filter((id) => id.endsWith(".remove"))).toHaveLength(2);
	expect(rows.every((row) => row.section === "Anthropic")).toBe(true);
	expect(rows[0]).toMatchObject({ label: "pi default", indent: 1 });
	expect(rows.filter((row) => row.indent === 2).map((row) => row.label)).toEqual([
		"Rename",
		"Remove",
		"Rename",
		"Remove",
	]);
});

test("using an account pins it for the session and remembers it, and default clears both", () => {
	const { store, pins, fake, rows } = setup();
	const work = store.accounts("anthropic").at(1);
	if (work === undefined) throw new Error("no second account");
	const use = rows.find((row) => row.id === `accounts.anthropic.${work.id}.use`);
	const fallback = rows.find((row) => row.id === "accounts.anthropic.default");
	if (use?.kind !== "action" || fallback?.kind !== "action") throw new Error("no rows");

	use.run(CTX);
	expect(pins.get("anthropic")).toBe(work.id);
	expect(store.active("anthropic")?.id).toBe(work.id);
	expect(fake.entries).toContainEqual({
		customType: SESSION_ENTRY,
		data: { kind: "account", provider: "anthropic", account: work.id },
	});

	fallback.run(CTX);
	expect(pins.get("anthropic")).toBeNull();
	expect(store.active("anthropic")).toBeUndefined();
});

test("renaming an account writes the store, and removing it clears its pin", () => {
	const { store, pins, rows } = setup();
	const first = store.accounts("anthropic").at(0);
	const second = store.accounts("anthropic").at(1);
	if (first === undefined || second === undefined) throw new Error("no accounts");
	const rename = rows.find((row) => row.id === `accounts.anthropic.${first.id}.label`);
	const remove = rows.find((row) => row.id === `accounts.anthropic.${second.id}.remove`);
	if (rename?.kind !== "value" || remove?.kind !== "action") throw new Error("no rows");

	expect(rename.set("home", CTX)).toBeUndefined();
	expect(store.accounts("anthropic")[0]?.label).toBe("home");

	pins.set("anthropic", second.id);
	expect(remove.run(CTX)).toContain("removed");
	expect(pins.get("anthropic")).toBeNull();
	expect(store.accounts("anthropic")).toHaveLength(1);
});

test("the status names the account the model uses, and stays quiet with one", () => {
	const { store, pins } = setup();
	const work = store.accounts("anthropic").at(1);
	if (work === undefined) throw new Error("no second account");

	expect(accountStatus(store, pins, CTX)).toBe("pi");
	pins.set("anthropic", work.id);
	expect(accountStatus(store, pins, CTX)).toBe("work");
	expect(
		accountStatus(new AccountStore(join(dir, "none.json")), new Map<string, string | null>(), CTX),
	).toBeUndefined();
});

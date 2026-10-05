import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";

import { fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { accountStatus } from "../src/accounts/actions.ts";
import { SESSION_ENTRY } from "../src/accounts/names.ts";
import type { Pins } from "../src/accounts/pins.ts";
import { accountRows } from "../src/accounts/screen.ts";
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

	expect(ids.some((id) => id.endsWith(".default"))).toBe(false);
	expect(ids.filter((id) => id.endsWith(".use"))).toHaveLength(2);
	expect(ids.filter((id) => id.endsWith(".label"))).toHaveLength(2);
	expect(ids.filter((id) => id.endsWith(".remove"))).toHaveLength(2);
	expect(rows.every((row) => row.section === "Anthropic")).toBe(true);
	expect(rows[0]).toMatchObject({ label: "personal", indent: 1 });
	expect(rows.filter((row) => row.indent === 2).map((row) => row.label)).toEqual([
		"Rename",
		"Remove",
		"Rename",
		"Remove",
	]);
});

test("using an account pins it for the session and remembers it", () => {
	const { store, pins, fake, rows } = setup();
	const work = store.accounts("anthropic").at(1);
	if (work === undefined) throw new Error("no second account");
	const use = rows.find((row) => row.id === `accounts.anthropic.${work.id}.use`);
	if (use?.kind !== "action") throw new Error("no row");

	use.run(CTX);
	expect(pins.get("anthropic")).toBe(work.id);
	expect(store.active("anthropic")?.id).toBe(work.id);
	expect(fake.entries).toContainEqual({
		customType: SESSION_ENTRY,
		data: { kind: "account", provider: "anthropic", account: work.id },
	});
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
	expect(pins.has("anthropic")).toBe(false);
	expect(store.accounts("anthropic")).toHaveLength(1);
});

test("removing the last account says the provider goes back to pi's own login", () => {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	const rows = accountRows(fakeScope({ pi: fakePi() }), store, new Map(), CTX);
	const remove = rows.find((row) => row.id.endsWith(".remove"));
	if (remove?.kind !== "action") throw new Error("no row");

	expect(remove.confirm).toContain("last Anthropic account");
});

test("the status names the account the model uses, and stays quiet without accounts", () => {
	const { store, pins } = setup();
	const work = store.accounts("anthropic").at(1);
	if (work === undefined) throw new Error("no second account");

	// No choice yet, so the first account is the one in use.
	expect(accountStatus(store, pins, CTX)).toBe("personal");
	pins.set("anthropic", work.id);
	expect(accountStatus(store, pins, CTX)).toBe("work");
	expect(accountStatus(new AccountStore(join(dir, "none.json")), new Map(), CTX)).toBeUndefined();
});

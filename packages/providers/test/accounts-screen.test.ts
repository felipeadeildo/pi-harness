import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { SESSION_ENTRY, type Pins } from "../src/accounts/pins.ts";
import { accountRows } from "../src/accounts/screen.ts";
import { AccountStore } from "../src/accounts/store.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };
const KEY: Credential = { type: "api_key", key: "k" };
const CTX = {} as ExtensionContext;

let dir: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.PI_CODING_AGENT_DIR;
	dir = mkdtempSync(join(tmpdir(), "pi-accounts-screen-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});

function setup() {
	const store = new AccountStore();
	store.add("anthropic", "personal", OAUTH);
	store.add("anthropic", "work", KEY);
	const pins: Pins = new Map();
	const fake = fakePi();
	return { store, pins, fake, rows: accountRows(fakeScope({ pi: fake }), store, pins) };
}

test("the screen lists a choice row per provider and a row per account", () => {
	const { rows } = setup();
	const ids = rows.map((row) => row.id);

	expect(ids).toContain("accounts.anthropic.active");
	expect(ids.filter((id) => id.endsWith(".label"))).toHaveLength(2);
	expect(ids.filter((id) => id.endsWith(".remove"))).toHaveLength(2);
});

test("picking an account pins it for the session, and default clears the pin", () => {
	const { store, pins, fake, rows } = setup();
	const work = store.accounts("anthropic").at(1);
	if (work === undefined) throw new Error("no second account");
	const active = rows.find((row) => row.id === "accounts.anthropic.active");
	if (active?.kind !== "value") throw new Error("no choice row");

	expect(active.get(CTX)).toBe("default");
	expect(active.set(work.id, CTX)).toBeUndefined();
	expect(pins.get("anthropic")).toBe(work.id);
	expect(active.get(CTX)).toBe(work.id);
	expect(fake.entries).toContainEqual({
		customType: SESSION_ENTRY,
		data: { kind: "account", provider: "anthropic", account: work.id },
	});

	expect(active.set("default", CTX)).toBeUndefined();
	expect(pins.get("anthropic")).toBeNull();
	expect(active.set("nope", CTX)).toBe("pick an account");
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

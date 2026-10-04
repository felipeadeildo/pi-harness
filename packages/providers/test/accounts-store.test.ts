import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Credential } from "@earendil-works/pi-ai";

import { AccountStore } from "../src/accounts/store.ts";
import { agentDirFixture } from "./helpers.ts";

const OAUTH: Credential = { type: "oauth", access: "a", refresh: "r", expires: 0 };

let dir: string;
let path: string;
let restore: () => void;

beforeEach(() => {
	const fixture = agentDirFixture("pi-accounts-");
	dir = fixture.dir;
	restore = fixture.restore;
	path = join(dir, "accounts.json");
});

afterEach(() => restore());

function addWork(store: AccountStore): string {
	store.add("anthropic", "work", OAUTH);
	return store.accounts("anthropic").at(-1)?.id ?? "";
}

test("an account is added, listed and pinned", () => {
	const store = new AccountStore(path);
	const added = store.add("anthropic", "personal", OAUTH);
	expect(added.problem).toBeUndefined();
	expect(added.account?.label).toBe("personal");
	expect(store.has("anthropic")).toBe(true);
	// No choice yet, so pi's own credential stays the one a request uses.
	expect(store.active("anthropic")).toBeUndefined();

	const work = addWork(store);
	expect(store.setActive("anthropic", work)).toBeUndefined();
	expect(store.active("anthropic")?.label).toBe("work");
	expect(store.setActive("anthropic", undefined)).toBeUndefined();
	expect(store.active("anthropic")).toBeUndefined();
});

test("a rename keeps the account, and a removal takes the pin with it", () => {
	const store = new AccountStore(path);
	store.add("anthropic", "personal", OAUTH);
	const id = store.accounts("anthropic")[0]?.id ?? "";
	store.setActive("anthropic", id);

	expect(store.rename("anthropic", id, "home")).toBeUndefined();
	expect(store.active("anthropic")?.label).toBe("home");

	expect(store.remove("anthropic", id)).toBeUndefined();
	expect(store.has("anthropic")).toBe(false);
	expect(store.providerIds()).toEqual([]);
});

test("a refreshed credential is kept", () => {
	const store = new AccountStore(path);
	store.add("anthropic", "personal", OAUTH);
	const id = store.accounts("anthropic")[0]?.id ?? "";
	const fresh: Credential = { type: "oauth", access: "new", refresh: "r", expires: 42 };

	expect(store.setCredential("anthropic", id, fresh)).toBeUndefined();
	expect(store.accounts("anthropic")[0]?.credential).toEqual(fresh);
});

test("the file is the only place an account lives", () => {
	const store = new AccountStore(path);
	store.add("anthropic", "personal", OAUTH);
	const id = store.accounts("anthropic")[0]?.id ?? "";

	const again = new AccountStore(path);
	again.reload();
	expect(again.accounts("anthropic")[0]?.id).toBe(id);
	expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
		version: 1,
		providers: { anthropic: { accounts: [{ label: "personal" }] } },
	});
});

test("a hand edit that does not parse is never overwritten", () => {
	writeFileSync(path, "{ not json");
	const store = new AccountStore(path);

	expect(store.reload()[0]).toContain("could not be read");
	expect(store.has("anthropic")).toBe(false);
	expect(store.add("anthropic", "personal", OAUTH).problem).toContain("could not be read");
	expect(readFileSync(path, "utf8")).toBe("{ not json");
});

test("an entry that is not a credential is dropped", () => {
	writeFileSync(
		path,
		JSON.stringify({
			version: 1,
			providers: { anthropic: { accounts: [{ id: "x", label: "x" }] } },
		}),
	);
	const store = new AccountStore(path);
	expect(store.has("anthropic")).toBe(false);
});

test("health survives a reload, and a hand edit cannot break it", () => {
	const store = new AccountStore(path);
	const id = addWork(store);
	store.markError("anthropic", id, "auth", "invalid_grant");
	store.markLimited("anthropic", id, 1_800_000_000);

	const saved = new AccountStore(path).accounts("anthropic")[0];
	expect(saved?.health?.lastError).toMatchObject({ kind: "auth", message: "invalid_grant" });
	expect(saved?.health?.limitedUntil).toBe(1_800_000_000);

	store.clearError("anthropic", id);
	store.markLimited("anthropic", id, undefined);
	expect(new AccountStore(path).accounts("anthropic")[0]?.health).toBeUndefined();

	writeFileSync(
		path,
		JSON.stringify({
			version: 1,
			providers: {
				anthropic: {
					accounts: [
						{
							id: "x",
							label: "work",
							credential: OAUTH,
							health: { lastError: { at: "nope" }, limitedUntil: "nope" },
						},
					],
				},
			},
		}),
	);
	expect(new AccountStore(path).accounts("anthropic")[0]?.health).toBeUndefined();
});

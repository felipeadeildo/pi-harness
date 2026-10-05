import { expect, test } from "bun:test";

import { SESSION_ENTRY } from "../src/accounts/names.ts";
import { replay } from "../src/accounts/pins.ts";

function entry(data: unknown): unknown {
	return { type: "custom", customType: SESSION_ENTRY, data };
}

test("a branch replays its pins, newest winning", () => {
	const pins = replay([
		entry({ kind: "account", provider: "anthropic", account: "w" }),
		entry({ kind: "account", provider: "openai", account: "o" }),
		entry({ kind: "account", provider: "openai", account: "p" }),
	]);

	expect(pins.get("anthropic")).toBe("w");
	expect(pins.get("openai")).toBe("p");
});

test("an older session's pin on pi's own credential goes back to the store's choice", () => {
	const pins = replay([
		entry({ kind: "account", provider: "anthropic", account: "w" }),
		entry({ kind: "default", provider: "anthropic" }),
	]);

	expect(pins.has("anthropic")).toBe(false);
});

test("anything that is not our entry is ignored", () => {
	const pins = replay([
		{ type: "custom", customType: "pi-ask-permission:session", data: { kind: "mode" } },
		{ type: "message", data: { kind: "account", provider: "anthropic", account: "w" } },
		entry({ kind: "account", provider: "anthropic" }),
		entry({ nope: true }),
		{
			type: "custom",
			customType: SESSION_ENTRY,
			data: { kind: "account", provider: "anthropic", account: "ok" },
		},
	]);

	expect([...pins]).toEqual([["anthropic", "ok"]]);
});

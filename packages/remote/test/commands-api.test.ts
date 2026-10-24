// What a client's `session.rename`, `model.set` and `thinking.set` reach: pi's own setters, and the
// refusal each one gives instead of a silent nothing when it cannot be honoured.
import { describe, expect, test } from "bun:test";

import { type By, MODE_SET } from "@adeildo/pi-kit";
import { fakeContext, fakeScope } from "@adeildo/pi-kit/testing";

import { commandApi, isThinkingLevel, THINKING_LEVELS } from "../src/commands-api.ts";

interface Model {
	provider: string;
	id: string;
}

/** A context whose registry knows these models, and a scope whose pi keeps the last settings. */
function api(options: { models?: Model[]; switches?: boolean } = {}) {
	const models = options.models ?? [{ provider: "rig", id: "scripted" }];
	const scope = fakeScope();
	const ctx = fakeContext([], true, {
		modelRegistry: {
			find: (provider: string, id: string) =>
				models.find((one) => one.provider === provider && one.id === id),
		},
	});
	const switched: { provider: string; id: string }[] = [];
	const thinking: string[] = [];
	const scopeWithSwitch = {
		...scope,
		setModel: (model: Model) => {
			switched.push(model);
			return Promise.resolve(options.switches ?? true);
		},
		setThinkingLevel: (level: string) => void thinking.push(level),
	};
	return { api: commandApi(scopeWithSwitch, ctx), scope: scopeWithSwitch, switched, thinking };
}

describe("the commands' side of pi", () => {
	test("renames the session through pi, which keeps the name", () => {
		const { api: commands, scope } = api();
		commands.rename("release check");
		expect(scope.getSessionName?.()).toBe("release check");
	});

	test("switches the model it finds by provider and id", async () => {
		const { api: commands, switched } = api();
		await commands.setModel("rig", "scripted");
		expect(switched).toEqual([{ provider: "rig", id: "scripted" }]);
	});

	test("refuses a model this machine does not have", async () => {
		const { api: commands, switched } = api();
		await expect(commands.setModel("rig", "none")).rejects.toThrow(
			"no model rig/none on this machine",
		);
		expect(switched).toEqual([]);
	});

	test("refuses when pi kept the model it had, so a client never hears a switch that did not happen", async () => {
		const { api: commands } = api({ switches: false });
		await expect(commands.setModel("rig", "scripted")).rejects.toThrow(
			"the model stayed as it was",
		);
	});

	test("sets a thinking level pi knows, and refuses one it does not, naming the ones it does", () => {
		const { api: commands, thinking } = api();
		commands.setThinking("xhigh");
		expect(thinking).toEqual(["xhigh"]);
		expect(() => commands.setThinking("turbo")).toThrow(
			`turbo is not a thinking level: ${THINKING_LEVELS.join(", ")}`,
		);
		expect(thinking).toEqual(["xhigh"]);
	});

	test("sets a permission mode through the feature that owns it, naming who asked", () => {
		const { api: commands, scope } = api();
		const asked: { mode: string; by?: By }[] = [];
		MODE_SET.provide(scope, () => ({ set: (mode, by) => asked.push({ mode, by }) }));
		commands.setMode("edits", { kind: "client", name: "phone", machine: "laptop" });
		expect(asked).toEqual([
			{ mode: "edits", by: { kind: "client", name: "phone", machine: "laptop" } },
		]);
	});

	test("refuses full from a client: it runs every call, and it is set at the terminal", () => {
		const { api: commands, scope } = api();
		const asked: string[] = [];
		MODE_SET.provide(scope, () => ({ set: (mode) => asked.push(mode) }));
		expect(() => commands.setMode("full", undefined)).toThrow("full is only set at the terminal");
		expect(asked).toEqual([]);
	});

	test("refuses a mode pi does not have, and a session with no permission feature", () => {
		const { api: commands, scope } = api();
		MODE_SET.provide(scope, () => ({ set: () => {} }));
		expect(() => commands.setMode("sometimes", undefined)).toThrow(
			"sometimes is not a permission mode",
		);
		const bare = api();
		expect(() => bare.api.setMode("edits", undefined)).toThrow(
			"this session has no permission feature to change the mode",
		);
	});

	test("knows exactly the levels pi offers, and nothing between them", () => {
		for (const level of THINKING_LEVELS) expect(isThinkingLevel(level)).toBe(true);
		for (const other of ["off", "maximal", "", "HIGH"]) expect(isThinkingLevel(other)).toBe(false);
	});
});

// What a client's `session.rename`, `model.set` and `thinking.set` reach: pi's own setters, and the
// refusal each one gives instead of a silent nothing when it cannot be honoured.
import { describe, expect, test } from "bun:test";

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

	test("knows exactly the levels pi offers, and nothing between them", () => {
		for (const level of THINKING_LEVELS) expect(isThinkingLevel(level)).toBe(true);
		for (const other of ["off", "maximal", "", "HIGH"]) expect(isThinkingLevel(other)).toBe(false);
	});
});

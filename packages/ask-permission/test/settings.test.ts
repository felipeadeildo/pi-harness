import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "#core/config/schema.ts";
import { defaultJudge } from "#core/judge/config.ts";
import { PERMISSION_MODES } from "#core/mode.ts";
import { buildJudgeSettings, judgeValues } from "#ui/settings/judge.ts";
import { topLevelItems } from "#ui/settings/screen.ts";

function judgeScreen(): ReturnType<typeof buildJudgeSettings> {
	return buildJudgeSettings({
		config: defaultJudge(),
		theme: {} as Theme,
		piModels: [],
		save: () => {},
		editPolicy: () => {},
		editModel: () => {},
	});
}

function rows(config = defaultConfig(), session = { mode: "edits", outside: "allow" } as const) {
	return topLevelItems(config, session, []);
}

describe("settings layout", () => {
	test("the session rows come first, then the defaults for new sessions", () => {
		expect(rows().map((item) => item.id)).toEqual([
			"session.mode",
			"session.outside",
			"mode",
			"workspace.outside",
			"readOnlyBash",
			"notes",
			"noUI",
		]);
	});

	test("the session rows show the session, the defaults show the config", () => {
		const config = defaultConfig();
		config.mode = "judge";
		config.workspace.outside = "deny";
		const byId = new Map(rows(config).map((item) => [item.id, item.currentValue]));

		expect(byId.get("session.mode")).toBe("edits");
		expect(byId.get("session.outside")).toBe("allow");
		expect(byId.get("mode")).toBe("judge");
		expect(byId.get("workspace.outside")).toBe("deny");
	});

	test("the mode rows offer every mode, the outside rows every scope", () => {
		for (const item of rows()) {
			if (item.id.endsWith("mode")) expect(item.values).toEqual([...PERMISSION_MODES]);
			if (item.id.endsWith("outside")) expect(item.values).toEqual(["ask", "allow", "deny"]);
			expect(item.description).toBeTruthy();
		}
	});

	test("the read-only row marks the config", () => {
		const find = (config = defaultConfig()) =>
			rows(config).find((item) => item.id === "readOnlyBash")?.currentValue;
		expect(find()).toBe("on");
		expect(find({ ...defaultConfig(), readOnlyBash: false })).toBe("off");
	});

	test("the judge rows are the ones judgeValues knows, and none switches the judge on", () => {
		const ids = judgeScreen().items.map((item) => item.id);
		expect(ids).toEqual(Object.keys(judgeValues(defaultJudge())));
		expect(ids).not.toContain("judge.enabled");
		expect(ids).not.toContain("judge.tools");
	});

	test("every judge row explains itself", () => {
		for (const item of judgeScreen().items) {
			expect(item.label.trim().length).toBeGreaterThan(0);
			expect(item.description?.length ?? 0).toBeGreaterThan(0);
		}
	});
});

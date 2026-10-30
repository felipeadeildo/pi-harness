import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import type { ExtensionContext, PackageSource } from "@earendil-works/pi-coding-agent";

import { applyDefaults } from "../src/config.ts";
import { ANSWER_MODELS, WEB_DEFAULTS } from "../src/defaults.ts";
import { webFeature } from "../src/index.ts";
import { standaloneSource } from "../src/standalone.ts";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function paths(): { config: string; decided: string } {
	const dir = mkdtempSync(join(tmpdir(), "pi-web-"));
	made.push(dir);
	return { config: join(dir, "web-search.json"), decided: join(dir, "decided.json") };
}

function read(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8"));
}

const DEEPSEEK = { provider: "deepseek", model: "deepseek-flash" };
const ROUTING = WEB_DEFAULTS.find((one) => one.key === "searchRouting")?.value;

describe("the defaults the harness writes", () => {
	test("a missing file gets every default and the answer model", () => {
		const at = paths();
		expect(applyDefaults(at.config, at.decided, DEEPSEEK).written).toEqual([
			"searchRouting",
			"fetchRouting",
			"fetch.answer",
		]);
		expect(read(at.config)).toMatchObject({
			searchRouting: ROUTING,
			fetch: { answerProvider: "deepseek", answerModel: "deepseek-flash" },
		});
	});

	test("what the person already set stays as it is, keys of their own included", () => {
		const at = paths();
		const theirs = {
			deepseekApiKey: "!jq -r .deepseek.key auth.json",
			searchRouting: { providers: ["brave"], fallbackOn: ["quota"] },
			fetch: { answerProvider: "anthropic", answerModel: "claude-haiku-4-5", maxChars: 9 },
		};
		writeFileSync(at.config, JSON.stringify(theirs));
		expect(applyDefaults(at.config, at.decided, DEEPSEEK).written).toEqual(["fetchRouting"]);
		expect(read(at.config)).toMatchObject(theirs);
	});

	test("a default the person removed is not written back", () => {
		const at = paths();
		applyDefaults(at.config, at.decided, DEEPSEEK);
		const config = read(at.config);
		delete config.searchRouting;
		delete config.fetch;
		writeFileSync(at.config, JSON.stringify(config));
		expect(applyDefaults(at.config, at.decided, DEEPSEEK).written).toEqual([]);
		expect(read(at.config).searchRouting).toBeUndefined();
	});

	test("with no login for any answer model, it waits for one instead of deciding", () => {
		const at = paths();
		applyDefaults(at.config, at.decided, undefined);
		expect(read(at.config).fetch).toBeUndefined();
		expect(applyDefaults(at.config, at.decided, DEEPSEEK).written).toEqual(["fetch.answer"]);
	});

	test("a file that is not JSON is left alone", () => {
		const at = paths();
		writeFileSync(at.config, "{ nope");
		expect(applyDefaults(at.config, at.decided, DEEPSEEK).error).toContain("not valid JSON");
		expect(readFileSync(at.config, "utf8")).toBe("{ nope");
		expect(existsSync(at.decided)).toBe(false);
	});
});

describe("a pi-web-access installed on its own", () => {
	test("is found in every form a package source takes", () => {
		const sources: PackageSource[][] = [
			["npm:pi-web-access"],
			["npm:pi-web-access@0.46.0"],
			["git:github.com/nicobailon/pi-web-access"],
			["https://github.com/nicobailon/pi-web-access.git"],
			["/home/me/code/pi-web-access"],
			[{ source: "npm:pi-web-access", skills: [] }],
		];
		for (const packages of sources) expect(standaloneSource(packages)).toBeDefined();
	});

	test("is not confused with another package, or one whose extensions are off", () => {
		expect(standaloneSource(["npm:pi-web-access-plus", "npm:@adeildo/pi-harness"])).toBeUndefined();
		expect(standaloneSource([{ source: "npm:pi-web-access", extensions: [] }])).toBeUndefined();
	});
});

function context(notes: string[], logins: string[]): ExtensionContext {
	return fakeContext(notes, true, {
		modelRegistry: {
			find: (provider: string, id: string) => ({ provider, id }),
			hasConfiguredAuth: (model: { provider: string }) => logins.includes(model.provider),
		},
	});
}

async function start(packages: PackageSource[], logins: string[]) {
	const at = paths();
	const fake = fakePi();
	const mounted: unknown[] = [];
	createApp(fake.pi, { name: "pi-harness" })
		.use(
			webFeature({
				decidedPath: at.decided,
				configPath: () => at.config,
				packages: () => packages,
				mount: (pi) => void mounted.push(pi),
			}),
		)
		.build();
	const notes: string[] = [];
	const fire = () => fake.fire("session_start", { reason: "startup" }, context(notes, logins));
	await fire();
	return { at, mounted, notes, fire };
}

describe("the web piece", () => {
	test("mounts pi-web-access and writes the defaults with the first answer model logged in", async () => {
		const { at, mounted, notes } = await start([], ["openai-codex", "deepseek"]);
		expect(mounted).toHaveLength(1);
		expect(read(at.config).fetch).toEqual({
			answerProvider: "deepseek",
			answerModel: "deepseek-flash",
		});
		expect(notes.join("\n")).toContain("answers from deepseek/deepseek-flash");
	});

	test("falls back to the next answer model when the first has no login", async () => {
		const { at } = await start([], ["openai-codex"]);
		expect(read(at.config).fetch).toEqual({
			answerProvider: ANSWER_MODELS[1]?.provider,
			answerModel: ANSWER_MODELS[1]?.model,
		});
	});

	test("stays off next to a pi-web-access installed on its own, and says so once", async () => {
		const { mounted, notes, fire } = await start(["npm:pi-web-access"], []);
		expect(mounted).toHaveLength(0);
		await fire();
		expect(notes.filter((note) => note.includes("installed on its own"))).toHaveLength(1);
	});
});

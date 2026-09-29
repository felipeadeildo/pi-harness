import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	boolean,
	integer,
	literal,
	matching,
	type Setting,
	setting,
	SettingsStore,
	stringList,
} from "../src/index.ts";

const version = setting({
	id: "subscription.claudeCodeVersion",
	default: "2.1.280",
	decoder: matching(/^\d+\.\d+\.\d+$/, "a version like 2.1.280"),
});
const enabled = setting({ id: "subscription.enabled", default: true, decoder: boolean });
const hidden = setting({
	id: "hide.providers",
	default: [] as string[],
	decoder: stringList("names"),
});
const pathLength = setting({ id: "statusline.pathLength", default: 40, decoder: integer(0, 500) });

const preset = setting({
	id: "statusline.preset",
	default: "full",
	decoder: literal("full", "minimal"),
	project: true,
});

let dir: string;
let globalPath: string;
let projectPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-kit-settings-"));
	globalPath = join(dir, "global", "settings.json");
	projectPath = join(dir, "project", "settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
}

function store(...settings: Setting<unknown>[]): SettingsStore {
	const created = new SettingsStore(globalPath);
	created.register(settings);
	return created;
}

describe("the global file", () => {
	test("a missing file means every default, with no warning", () => {
		const settings = store(version, enabled);
		expect(settings.load()).toEqual([]);
		expect(version.get({ settings })).toBe("2.1.280");
		expect(enabled.get({ settings })).toBe(true);
	});

	test("reads a value at its dotted path", () => {
		write(globalPath, { subscription: { claudeCodeVersion: "2.1.300" } });
		const settings = store(version);
		expect(settings.load()).toEqual([]);
		expect(version.get({ settings })).toBe("2.1.300");
	});

	test("a number out of range is ignored", () => {
		write(globalPath, { statusline: { pathLength: 900 } });
		const settings = store(pathLength);
		expect(settings.load()).toEqual([
			`${globalPath}: statusline.pathLength: expected a whole number from 0 to 500; ignored`,
		]);
		expect(pathLength.get({ settings })).toBe(40);
	});

	test("an invalid value is ignored, and the warning says where", () => {
		write(globalPath, { subscription: { claudeCodeVersion: "latest" } });
		const settings = store(version);
		expect(settings.load()).toEqual([
			`${globalPath}: subscription.claudeCodeVersion: expected a version like 2.1.280; ignored`,
		]);
		expect(version.get({ settings })).toBe("2.1.280");
	});

	test("keys another app declared are not this store's business", () => {
		write(globalPath, { permission: { mode: "auto" }, subscription: {} });
		expect(store(version).load()).toEqual([]);
	});

	test("a file that is not JSON warns once and uses the defaults", () => {
		write(globalPath, "{ nope");
		const settings = store(version);
		const warnings = settings.load();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toStartWith(`${globalPath}: could not be read`);
		expect(version.get({ settings })).toBe("2.1.280");
	});

	test("reading before any load loads the file", () => {
		write(globalPath, { subscription: { enabled: false } });
		expect(enabled.get({ settings: store(enabled) })).toBe(false);
	});

	test("two different settings with one id are a mistake", () => {
		const twin = setting({ id: "subscription.enabled", default: false, decoder: boolean });
		expect(() => store(enabled, twin)).toThrow('two settings are named "subscription.enabled"');
		expect(() => store(enabled, enabled)).not.toThrow();
	});
});

describe("the project file", () => {
	test("wins for a setting that accepts it", () => {
		write(globalPath, { statusline: { preset: "full" } });
		write(projectPath, { statusline: { preset: "minimal" } });
		const settings = store(preset);
		expect(settings.load(projectPath)).toEqual([]);
		expect(preset.get({ settings })).toBe("minimal");
	});

	test("cannot set a setting that did not ask for it", () => {
		write(projectPath, { subscription: { claudeCodeVersion: "9.9.9" } });
		const settings = store(version);
		expect(settings.load(projectPath)).toEqual([
			`${projectPath}: subscription.claudeCodeVersion: only the global settings file can set this; ignored`,
		]);
		expect(version.get({ settings })).toBe("2.1.280");
	});

	test("an invalid project value falls back to the global one", () => {
		write(globalPath, { statusline: { preset: "minimal" } });
		write(projectPath, { statusline: { preset: "huge" } });
		const settings = store(preset);
		expect(settings.load(projectPath)).toEqual([
			`${projectPath}: statusline.preset: expected "full" or "minimal"; ignored`,
		]);
		expect(preset.get({ settings })).toBe("minimal");
	});

	test("is not read unless the caller passes it", () => {
		write(projectPath, { statusline: { preset: "minimal" } });
		const settings = store(preset);
		settings.load();
		expect(preset.get({ settings })).toBe("full");
	});
});

describe("writing", () => {
	test("keeps every key it does not know", () => {
		write(globalPath, { permission: { mode: "auto" }, subscription: { enabled: true } });
		const settings = store(version, enabled);
		expect(settings.set(version, "2.1.301")).toBeUndefined();
		expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({
			permission: { mode: "auto" },
			subscription: { enabled: true, claudeCodeVersion: "2.1.301" },
		});
		expect(version.get({ settings })).toBe("2.1.301");
	});

	test("creates the file and its folder", () => {
		const settings = store(enabled);
		expect(settings.set(enabled, false)).toBeUndefined();
		expect(JSON.parse(readFileSync(globalPath, "utf8"))).toEqual({
			subscription: { enabled: false },
		});
	});

	test("a project value still wins after a global write", () => {
		write(projectPath, { statusline: { preset: "minimal" } });
		const settings = store(preset);
		settings.load(projectPath);
		settings.set(preset, "full");
		expect(preset.get({ settings })).toBe("minimal");
	});
});

describe("listening", () => {
	test("hears changes from a write and from a load, and nothing else", () => {
		const settings = store(hidden);
		settings.load();
		const heard: string[][] = [];
		hidden.listen({ settings }, (value) => heard.push(value));

		settings.load();
		expect(heard).toEqual([]);

		settings.set(hidden, ["amazon-bedrock"]);
		expect(heard).toEqual([["amazon-bedrock"]]);

		settings.load();
		expect(heard).toEqual([["amazon-bedrock"]]);

		write(globalPath, {});
		settings.load();
		expect(heard).toEqual([["amazon-bedrock"], []]);
	});

	test("stops when unsubscribed", () => {
		const settings = store(enabled);
		const heard: boolean[] = [];
		const stop = enabled.listen({ settings }, (value) => heard.push(value));
		stop();
		settings.set(enabled, false);
		expect(heard).toEqual([]);
	});
});

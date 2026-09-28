import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { boolean, matching, setting, SettingsStore, stringList } from "../src/index.ts";

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

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-kit-settings-"));
	path = join(dir, "settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function store(...settings: Parameters<SettingsStore["register"]>[0]): SettingsStore {
	const created = new SettingsStore(path);
	created.register(settings);
	return created;
}

describe("reading", () => {
	test("a missing file means every default, with no warning", () => {
		const settings = store(version, enabled);
		expect(settings.load()).toEqual([]);
		expect(version.get({ settings })).toBe("2.1.280");
		expect(enabled.get({ settings })).toBe(true);
	});

	test("reads a value at its dotted path", () => {
		writeFileSync(path, JSON.stringify({ subscription: { claudeCodeVersion: "2.1.300" } }));
		const settings = store(version);
		expect(settings.load()).toEqual([]);
		expect(version.get({ settings })).toBe("2.1.300");
	});

	test("an invalid value falls back to the default and says where", () => {
		writeFileSync(path, JSON.stringify({ subscription: { claudeCodeVersion: "latest" } }));
		const settings = store(version);
		expect(settings.load()).toEqual([
			`${path}: subscription.claudeCodeVersion: expected a version like 2.1.280; using the default`,
		]);
		expect(version.get({ settings })).toBe("2.1.280");
	});

	test("keys another app declared are not this store's business", () => {
		writeFileSync(path, JSON.stringify({ permission: { mode: "auto" }, subscription: {} }));
		expect(store(version).load()).toEqual([]);
	});

	test("a file that is not JSON warns once and uses the defaults", () => {
		writeFileSync(path, "{ nope");
		const settings = store(version);
		const warnings = settings.load();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toStartWith(`${path}: could not be read`);
		expect(version.get({ settings })).toBe("2.1.280");
	});

	test("reading before any load loads the file", () => {
		writeFileSync(path, JSON.stringify({ subscription: { enabled: false } }));
		expect(enabled.get({ settings: store(enabled) })).toBe(false);
	});

	test("two different settings with one id are a mistake", () => {
		const twin = setting({ id: "subscription.enabled", default: false, decoder: boolean });
		expect(() => store(enabled, twin)).toThrow('two settings are named "subscription.enabled"');
		expect(() => store(enabled, enabled)).not.toThrow();
	});
});

describe("writing", () => {
	test("keeps every key it does not know", () => {
		writeFileSync(
			path,
			JSON.stringify({ permission: { mode: "auto" }, subscription: { enabled: true } }),
		);
		const settings = store(version, enabled);
		expect(settings.set(version, "2.1.301")).toBeUndefined();
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			permission: { mode: "auto" },
			subscription: { enabled: true, claudeCodeVersion: "2.1.301" },
		});
		expect(version.get({ settings })).toBe("2.1.301");
	});

	test("creates the file and its folder", () => {
		path = join(dir, "nested", "settings.json");
		const settings = store(enabled);
		expect(settings.set(enabled, false)).toBeUndefined();
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ subscription: { enabled: false } });
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
		writeFileSync(path, JSON.stringify({ hide: { providers: ["amazon-bedrock"] } }));
		settings.load();
		expect(heard).toEqual([["amazon-bedrock"]]);

		writeFileSync(path, JSON.stringify({}));
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

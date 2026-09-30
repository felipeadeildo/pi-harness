import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SettingsStore, type SettingsScope, globalSettingsPath } from "@adeildo/pi-kit";

import { decodeConfig } from "#core/config/decode.ts";
import { noUIMode, isAllowed, matchesPattern } from "#core/config/patterns.ts";
import { DEFAULT_CONFIG, DEFAULT_WORKSPACE, type PermissionConfig } from "#core/config/schema.ts";
import {
	migrateConfig,
	PERMISSION_SETTINGS,
	readConfig,
	writeConfig,
} from "#core/config/settings.ts";
import { configPath } from "#core/config/store.ts";
import { DEFAULT_JUDGE } from "#core/judge/config.ts";
import { decodeJudge } from "#core/judge/decode.ts";

describe("matchesPattern", () => {
	test.each([
		["git", "git", true],
		["git*", "git", true],
		["git*", "github", true],
		["mcp_*", "mcp_github", true],
		["mcp_*", "bash", false],
		["?at", "cat", true],
		["?at", "chat", false],
		["*", "anything", true],
		["read", "write", false],
	])("%s vs %s", (pattern, value, expected) => {
		expect(matchesPattern(pattern as string, value as string)).toBe(expected);
	});

	test("regex metacharacters are literal", () => {
		expect(matchesPattern("a.b", "axb")).toBe(false);
		expect(matchesPattern("a.b", "a.b")).toBe(true);
	});
});

describe("decodeConfig", () => {
	test("an empty object yields the defaults", () => {
		expect(decodeConfig({}, [])).toEqual(DEFAULT_CONFIG);
	});

	test("drops non-string allow entries and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ allow: ["bash", 3, ""] }, warnings).allow).toEqual(["bash"]);
		expect(warnings).toHaveLength(1);
	});

	test("keeps a valid noUI map and drops invalid modes", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ noUI: { bash: "deny", bad: "nope" } }, warnings).noUI).toEqual({
			bash: "deny",
		});
		expect(warnings).toEqual(['noUI.bad: expected "allow" or "deny"']);
	});

	test("rejects a bad notes value", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ notes: "carrier-pigeon" }, warnings).notes).toBe("result");
		expect(warnings).toHaveLength(1);
	});

	test("rejects a bad mode", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ mode: "sometimes" }, warnings).mode).toBe(DEFAULT_CONFIG.mode);
		expect(warnings).toHaveLength(1);
	});

	test("reads a valid mode, and the 4.x names as the new ones", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ mode: "judge" }, warnings).mode).toBe("judge");
		expect(decodeConfig({ mode: "accept-edits" }, warnings).mode).toBe("edits");
		expect(decodeConfig({ mode: "auto" }, warnings).mode).toBe("full");
		expect(warnings).toEqual([]);
	});

	test("a judge that was switched on becomes the judge mode", () => {
		expect(decodeConfig({ judge: { enabled: true } }).mode).toBe("judge");
		expect(decodeConfig({ mode: "accept-edits", judge: { enabled: true } }).mode).toBe("edits");
		expect(decodeConfig({ judge: { enabled: false } }).mode).toBe("manual");
	});

	test("drops the removed yolo key and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ yolo: true }, warnings).mode).toBe("manual");
		expect(warnings).toContain("yolo is gone, the mode is picked per session");
	});

	test("moves a persisted yolo mode to full and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ mode: "yolo" }, warnings).mode).toBe("full");
		expect(warnings).toContain(
			'mode "yolo" is now "full", with workspace.outside "allow" for the same reach',
		);
	});

	test("reads a workspace block", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ workspace: { roots: [".", "~/Projects"] } }, warnings).workspace).toEqual(
			{ roots: [".", "~/Projects"], outside: "ask" },
		);
		expect(warnings).toEqual([]);
	});

	test("falls back on a bad workspace block", () => {
		const warnings: string[] = [];
		expect(
			decodeConfig({ workspace: { roots: "~", outside: "maybe" } }, warnings).workspace,
		).toEqual(DEFAULT_CONFIG.workspace);
		expect(warnings).toHaveLength(2);
	});

	test("rejects an array where an object is expected", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ allow: "bash" }, warnings).allow).toEqual(DEFAULT_CONFIG.allow);
		expect(warnings).toHaveLength(1);
	});

	test("reads a typing block", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ typing: { pause: 250, maxWait: 5000 } }, warnings).typing).toEqual({
			pause: 250,
			maxWait: 5000,
		});
		expect(warnings).toEqual([]);
	});

	test("a missing typing.maxWait means no cap", () => {
		expect(decodeConfig({}, []).typing.maxWait).toBeNull();
		expect(decodeConfig({ typing: { maxWait: null } }, []).typing.maxWait).toBeNull();
	});

	test("drops invalid typing values and warns", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ typing: { pause: -1, maxWait: "soon" } }, warnings).typing).toEqual(
			DEFAULT_CONFIG.typing,
		);
		expect(warnings).toHaveLength(2);
	});

	test("rejects a non-object typing value", () => {
		const warnings: string[] = [];
		expect(decodeConfig({ typing: 5 }, warnings).typing).toEqual(DEFAULT_CONFIG.typing);
		expect(warnings).toHaveLength(1);
	});

	test("an invalid higher-precedence value never widens access", () => {
		const warnings: string[] = [];
		const config = decodeConfig({ noUI: 42, allow: null, mode: "sometimes" }, warnings);
		expect(config).toEqual(DEFAULT_CONFIG);
		expect(warnings).toHaveLength(3);
	});
});

describe("isAllowed", () => {
	test("matches any pattern in the list", () => {
		const config = { ...DEFAULT_CONFIG, allow: ["read", "mcp_*"] };
		expect(isAllowed(config, "read")).toBe(true);
		expect(isAllowed(config, "mcp_github")).toBe(true);
		expect(isAllowed(config, "bash")).toBe(false);
	});
});

describe("decodeJudge", () => {
	test("an empty block yields the defaults", () => {
		expect(decodeJudge({}, [])).toEqual(DEFAULT_JUDGE);
	});

	test("reads a full block without warnings", () => {
		const warnings: string[] = [];
		const judge = decodeJudge(
			{
				provider: "pi",
				model: "anthropic/claude",
				alwaysAsk: ["rm -rf*"],
				thresholds: { allow: 0.9, deny: 0.7 },
				riskCeiling: 0.3,
				whenUnsure: "deny",
				canDeny: false,
				whenItFails: "deny",
				noUI: true,
				dryRun: true,
				rememberApprovals: true,
				cache: false,
				timeoutMs: 500,
				policy: "be careful",
			},
			warnings,
		);

		expect(warnings).toEqual([]);
		expect(judge).toEqual({
			provider: "pi",
			model: "anthropic/claude",
			alwaysAsk: ["rm -rf*"],
			thresholds: { allow: 0.9, deny: 0.7 },
			riskCeiling: 0.3,
			whenUnsure: "deny",
			canDeny: false,
			whenItFails: "deny",
			noUI: true,
			dryRun: true,
			rememberApprovals: true,
			cache: false,
			timeoutMs: 500,
			policy: "be careful",
		});
	});

	test("drops invalid values and warns, never widening", () => {
		const warnings: string[] = [];
		const judge = decodeJudge(
			{
				provider: "nope",
				thresholds: { allow: 2 },
				alwaysAsk: ["ok", 3, ""],
			},
			warnings,
		);

		expect(judge.provider).toBe("jev");
		expect(judge.thresholds.allow).toBe(DEFAULT_JUDGE.thresholds.allow);
		expect(judge.alwaysAsk).toEqual(["ok"]);
		expect(warnings).toContain('judge.provider: expected "jev" or "pi"');
		expect(warnings).toContain("judge.thresholds.allow: expected a number from 0 to 1");
		expect(warnings).toContain("judge.alwaysAsk: ignored entries that are not non-empty strings");
	});

	test("decodeConfig carries the judge block", () => {
		const config = decodeConfig({ judge: { model: "jev-x" } }, []);
		expect(config.judge.model).toBe("jev-x");
		expect(config.judge.cache).toBe(true);
	});

	test("a non-object judge block falls back to the defaults", () => {
		const warnings: string[] = [];
		const config = decodeConfig({ judge: 5 }, warnings);
		expect(config.judge).toEqual(DEFAULT_JUDGE);
		expect(warnings).toContain("judge: expected an object");
	});
});

describe("noUIMode", () => {
	test("a string applies to every tool", () => {
		expect(noUIMode({ ...DEFAULT_CONFIG, noUI: "allow" }, "bash")).toBe("allow");
	});

	test("defaults to deny when nothing matches", () => {
		expect(noUIMode({ ...DEFAULT_CONFIG, noUI: { bash: "allow" } }, "write")).toBe("deny");
	});

	test("an exact tool beats a wildcard regardless of file order", () => {
		const config: PermissionConfig = {
			...DEFAULT_CONFIG,
			noUI: { "*": "allow", bash: "deny" },
		};
		expect(noUIMode(config, "bash")).toBe("deny");
		expect(noUIMode(config, "write")).toBe("allow");
	});

	test("a wildcard beats * regardless of file order", () => {
		const config: PermissionConfig = {
			...DEFAULT_CONFIG,
			noUI: { "mcp_*": "allow", "*": "deny" },
		};
		expect(noUIMode(config, "mcp_github")).toBe("allow");
		expect(noUIMode(config, "bash")).toBe("deny");
	});
});

/** The old file, written where 3.x kept it. */
function writeLegacy(config: unknown): void {
	mkdirSync(dirname(configPath()), { recursive: true });
	writeFileSync(configPath(), typeof config === "string" ? config : JSON.stringify(config));
}

function scopeWithSettings(settingsPath = globalSettingsPath()): SettingsScope {
	const settings = new SettingsStore(settingsPath);
	settings.register(PERMISSION_SETTINGS);
	return { settings };
}

describe("config file", () => {
	let dir: string;
	let previous: string | undefined;

	beforeEach(() => {
		previous = process.env.PI_CODING_AGENT_DIR;
		dir = mkdtempSync(join(tmpdir(), "pi-perm-config-"));
		process.env.PI_CODING_AGENT_DIR = dir;
	});

	afterEach(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});

	test("config lives outside the checkout, under the agent dir", () => {
		expect(configPath()).toBe(join(dir, "extensions", "pi-ask-permission", "config.json"));
	});

	test("without an old file nothing is migrated and nothing is written", () => {
		const scope = scopeWithSettings();
		expect(migrateConfig(scope)).toEqual([]);
		expect(existsSync(globalSettingsPath())).toBe(false);
	});

	test("a malformed old file warns, changes nothing and is retired", () => {
		writeLegacy("{ not json");
		const scope = scopeWithSettings();

		const warnings = migrateConfig(scope);

		expect(warnings[0]).toContain("could not parse");
		expect(readConfig(scope)).toEqual(DEFAULT_CONFIG);
		expect(existsSync(`${configPath()}.bak`)).toBe(true);
	});

	test("every value from the old file lands in the shared settings", () => {
		writeLegacy({ notes: "message", allow: ["bash"], judge: { enabled: true, model: "jev-x" } });
		const scope = scopeWithSettings();

		migrateConfig(scope);

		const config = readConfig(scope);
		expect(config.notes).toBe("message");
		expect(config.allow).toEqual(["bash"]);
		expect(config.mode).toBe("judge");
		expect(config.judge.model).toBe("jev-x");
		expect(config.judge.timeoutMs).toBe(DEFAULT_JUDGE.timeoutMs);
	});

	test("the old file is kept as a backup", () => {
		writeLegacy({ notes: "message" });
		const scope = scopeWithSettings();

		expect(migrateConfig(scope).at(-1)).toContain(".bak");
		expect(existsSync(configPath())).toBe(false);
		expect(existsSync(`${configPath()}.bak`)).toBe(true);
	});

	test("only what differs from the defaults is written", () => {
		const scope = scopeWithSettings();
		writeConfig(scope, { ...DEFAULT_CONFIG, notes: "message" });

		expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toEqual({
			permission: { notes: "message" },
		});
	});

	test("a written config reads back the same", () => {
		const config: PermissionConfig = {
			...DEFAULT_CONFIG,
			mode: "judge",
			allow: ["read", "bash"],
			noUI: { bash: "allow" },
			readOnlyBash: false,
			workspace: { roots: ["src"], outside: "deny" },
			typing: { pause: 500, maxWait: 10_000 },
			judge: {
				...DEFAULT_JUDGE,
				policy: "só leitura",
				thresholds: { allow: 0.9, deny: 0.7 },
				alwaysAsk: ["sudo*"],
			},
		};

		expect(writeConfig(scopeWithSettings(), config)).toBeUndefined();
		expect(readConfig(scopeWithSettings())).toEqual(config);
	});

	test("a read does not alias the exported defaults", () => {
		const config = readConfig(scopeWithSettings());
		config.allow.push("bash");
		config.workspace.roots.push("..");
		config.judge.alwaysAsk.push("sudo*");

		expect(DEFAULT_CONFIG.allow).not.toContain("bash");
		expect(DEFAULT_WORKSPACE.roots).not.toContain("..");
		expect(DEFAULT_JUDGE.alwaysAsk).not.toContain("sudo*");
	});
});

import {
	boolean,
	type Decoder,
	duration,
	fail,
	fieldPath,
	formatProblems,
	isObject,
	literal,
	nullable,
	object,
	pass,
	problem,
	type Problem,
	stringList,
	withDefault,
	withDefaultOf,
} from "@adeildo/pi-kit";

import {
	DEFAULT_CONFIG,
	DEFAULT_TYPING,
	DEFAULT_WORKSPACE,
	defaultConfig,
	isMcpPolicy,
	type NoUIMode,
	type PermissionConfig,
	type TypingConfig,
	type WorkspaceConfig,
} from "#core/config/schema.ts";
import { defaultJudge } from "#core/judge/config.ts";
import { judgeConfig } from "#core/judge/decode.ts";
import { MCP_POLICIES, type McpPolicy } from "#core/mcp.ts";
import { DEFAULT_MODE, parseMode, PERMISSION_MODES, type PermissionMode } from "#core/mode.ts";

export type NoUIConfig = NoUIMode | Record<string, NoUIMode>;

export const noUI: Decoder<NoUIConfig> = {
	decode(input, path) {
		if (input === "allow" || input === "deny") return pass(input);
		if (!isObject(input)) return fail(problem(path, 'expected "allow", "deny", or a per-tool map'));

		const problems: Problem[] = [];
		const value: Record<string, NoUIMode> = {};
		for (const [tool, entry] of Object.entries(input)) {
			if (entry === "allow" || entry === "deny") value[tool] = entry;
			else problems.push(problem(fieldPath(path, tool), 'expected "allow" or "deny"'));
		}
		return pass(value, problems);
	},
};

export const mode: Decoder<PermissionMode> = {
	decode(input, path) {
		const value = typeof input === "string" ? parseMode(input) : undefined;
		if (value !== undefined) return pass(value);
		return fail(problem(path, `expected one of ${PERMISSION_MODES.join(", ")}`));
	},
};

/** The policy per MCP server, keyed by server name. */
export const mcpPolicies: Decoder<Record<string, McpPolicy>> = {
	decode(input, path) {
		if (!isObject(input)) return fail(problem(path, "expected a map of server to policy"));

		const problems: Problem[] = [];
		const value: Record<string, McpPolicy> = {};
		for (const [server, entry] of Object.entries(input)) {
			if (isMcpPolicy(entry)) value[server] = entry;
			else
				problems.push(
					problem(fieldPath(path, server), `expected one of ${MCP_POLICIES.join(", ")}`),
				);
		}
		return pass(value, problems);
	},
};

const typing: Decoder<TypingConfig> = object({
	pause: withDefault(duration, DEFAULT_TYPING.pause),
	maxWait: withDefault(nullable(duration), DEFAULT_TYPING.maxWait),
});

const workspace: Decoder<WorkspaceConfig> = object({
	roots: withDefaultOf(stringList("paths"), () => [...DEFAULT_WORKSPACE.roots]),
	outside: withDefault(literal("ask", "deny", "allow"), DEFAULT_WORKSPACE.outside),
});

const config: Decoder<PermissionConfig> = object({
	allow: withDefaultOf(stringList("tool names"), () => [...DEFAULT_CONFIG.allow]),
	noUI: withDefaultOf(noUI, () => DEFAULT_CONFIG.noUI),
	notes: withDefault(literal("result", "message"), DEFAULT_CONFIG.notes),
	mode: withDefault(mode, DEFAULT_MODE),
	readOnlyBash: withDefault(boolean, DEFAULT_CONFIG.readOnlyBash),
	workspace: withDefaultOf(workspace, () => ({
		...DEFAULT_WORKSPACE,
		roots: [...DEFAULT_WORKSPACE.roots],
	})),
	typing: withDefaultOf(typing, () => ({ ...DEFAULT_TYPING })),
	judge: withDefaultOf(judgeConfig, defaultJudge),
	mcp: withDefaultOf(object({ servers: withDefault(mcpPolicies, {}) }), () => ({ servers: {} })),
});

export function decodeConfig(input: unknown, warnings: string[] = []): PermissionConfig {
	const result = config.decode(migrate(input, warnings), "");
	warnings.push(...formatProblems(result.problems));

	return result.ok ? result.value : defaultConfig();
}

const RENAMED: [section: "judge" | undefined, from: string, to: string][] = [
	[undefined, "followup", "notes"],
	[undefined, "headless", "noUI"],
	["judge", "backend", "provider"],
	["judge", "autoDeny", "canDeny"],
	["judge", "onUncertain", "whenUnsure"],
	["judge", "onError", "whenItFails"],
	["judge", "never", "alwaysAsk"],
	["judge", "headless", "noUI"],
	["judge", "grant", "rememberApprovals"],
];

function migrate(input: unknown, warnings: string[]): unknown {
	if (!isObject(input)) return input;

	const next: Record<string, unknown> = { ...input };
	if (isObject(next.judge)) next.judge = { ...next.judge };

	for (const [section, from, to] of RENAMED) {
		const target = section === undefined ? next : next[section];
		if (!isObject(target) || !(from in target)) continue;

		if (!(to in target)) target[to] = target[from];
		delete target[from];
	}

	if (next.mode === "yolo") {
		next.mode = "full";
		warnings.push('mode "yolo" is now "full", with workspace.outside "allow" for the same reach');
	}
	// A judge switched on in 3.x becomes the judge mode.
	if (isObject(next.judge) && "enabled" in next.judge) {
		if (next.judge.enabled === true && (next.mode === undefined || next.mode === "manual")) {
			next.mode = "judge";
		}
		delete next.judge.enabled;
	}
	if ("yolo" in next) {
		delete next.yolo;
		warnings.push("yolo is gone, the mode is picked per session");
	}
	return next;
}

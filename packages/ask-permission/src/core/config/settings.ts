// One setting per leaf of the config. `readConfig` builds the nested config back.
import { existsSync, renameSync } from "node:fs";

import {
	boolean,
	type Control,
	type Decoder,
	duration,
	isObject,
	literal,
	nullable,
	readSettingsFile,
	type Setting,
	setting,
	type SettingsScope,
	type SettingUi,
	string,
	stringList,
	trimmedString,
	unit,
	writeSettingsFile,
} from "@adeildo/pi-kit";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { mode, type NoUIConfig, noUI, mcpPolicies } from "#core/config/decode.ts";
import {
	DEFAULT_CONFIG,
	DEFAULT_TYPING,
	DEFAULT_WORKSPACE,
	type NoteDelivery,
	type OutsideScope,
	type PermissionConfig,
	type TypingConfig,
	type WorkspaceConfig,
} from "#core/config/schema.ts";
import { configPath, readLegacyConfig } from "#core/config/store.ts";
import { modelName } from "#core/judge/classifier.ts";
import {
	DEFAULT_JUDGE,
	DEFAULT_RIGOR,
	JUDGE_RIGORS,
	type JudgeFallback,
	type JudgeRigor,
	RIGOR,
} from "#core/judge/config.ts";
import { POLICY_PRESETS } from "#core/judge/policy.ts";
import { MCP_POLICIES, MCP_POLICY_TEXT, type McpPolicy, sameServer } from "#core/mcp.ts";
import { DEFAULT_MODE, MODES, PERMISSION_MODES, type PermissionMode } from "#core/mode.ts";
import { OUTSIDE_DESCRIPTION, OUTSIDE_SCOPES } from "#core/workspace.ts";

export const SECTIONS = [
	"This session",
	"New sessions",
	"Workspace",
	"MCP servers",
	"Reads",
	"Dialog",
	"Judge",
	"Always yes",
] as const;

export type Section = (typeof SECTIONS)[number];

interface Leaf<T> extends Omit<SettingUi, "section"> {
	id: string;
	fallback: T;
	decoder: Decoder<T>;
	section: Section;
}

function leaf<T>(entry: Leaf<T>): Setting<T> {
	const { id, fallback, decoder, ...ui } = entry;
	return setting({ id: `permission.${id}`, default: fallback, decoder, ui });
}

/** A setting with no row of its own: the screen builds its row, or only the file sets it. */
function hiddenLeaf<T>(id: string, fallback: T, decoder: Decoder<T>): Setting<T> {
	return setting({ id: `permission.${id}`, default: fallback, decoder });
}

export const MCP_POLICY_CONTROL: Control = {
	type: "choice",
	options: MCP_POLICIES.map((value) => ({
		value,
		label: MCP_POLICY_TEXT[value].label,
		description: MCP_POLICY_TEXT[value].description,
	})),
};

export const MODE_CONTROL: Control = {
	type: "choice",
	options: PERMISSION_MODES.map((value) => ({ value, description: MODES[value].description })),
};

export const OUTSIDE_CONTROL: Control = {
	type: "choice",
	options: OUTSIDE_SCOPES.map((value) => ({ value, description: OUTSIDE_DESCRIPTION[value] })),
};

const judgeFallback = literal("ask", "allow", "deny");

const PERMISSION_LEAVES = {
	mode: leaf<PermissionMode>({
		id: "mode",
		fallback: DEFAULT_MODE,
		decoder: mode,
		section: "New sessions",
		label: "Mode",
		description: "The mode a new session starts in. Alt+M changes it for one session.",
		control: MODE_CONTROL,
	}),
	outside: leaf<OutsideScope>({
		id: "workspace.outside",
		fallback: DEFAULT_WORKSPACE.outside,
		decoder: literal("ask", "deny", "allow"),
		section: "New sessions",
		label: "Outside the workspace",
		description:
			"What a new session does with a call outside the roots. Alt+W changes it for one session.",
		control: OUTSIDE_CONTROL,
	}),
	roots: leaf({
		id: "workspace.roots",
		fallback: DEFAULT_WORKSPACE.roots,
		decoder: stringList("paths"),
		section: "Workspace",
		label: "Roots",
		description: "The folders the project is made of. Relative, absolute and ~ work.",
	}),
	servers: hiddenLeaf<Record<string, McpPolicy>>("mcp.servers", {}, mcpPolicies),
	allow: leaf({
		id: "allow",
		fallback: DEFAULT_CONFIG.allow,
		decoder: stringList("tool names"),
		section: "Reads",
		label: "Allowed tools",
		description: "Tools that run without asking. `mcp_*` matches a family.",
	}),
	readOnlyBash: leaf({
		id: "readOnlyBash",
		fallback: DEFAULT_CONFIG.readOnlyBash,
		decoder: boolean,
		section: "Reads",
		label: "Read-only bash",
		description: "Commands that only read run without asking. In full everything runs anyway.",
	}),
	notes: leaf<NoteDelivery>({
		id: "notes",
		fallback: DEFAULT_CONFIG.notes,
		decoder: literal("result", "message"),
		section: "Dialog",
		label: "Notes",
		description: "Where the note you write in the dialog goes.",
		control: {
			type: "choice",
			options: [
				{ value: "result", description: "added to the tool result" },
				{ value: "message", description: "sent as a message of its own" },
			],
		},
	}),
	noUI: leaf<NoUIConfig>({
		id: "noUI",
		fallback: DEFAULT_CONFIG.noUI,
		decoder: noUI,
		section: "Dialog",
		label: "With no dialog",
		description:
			"What happens when nobody can answer, as in print mode or a subagent. The file also takes a map per tool.",
		control: { type: "choice", options: [{ value: "deny" }, { value: "allow" }] },
	}),
	pause: leaf({
		id: "typing.pause",
		fallback: DEFAULT_TYPING.pause,
		decoder: duration,
		section: "Dialog",
		label: "Typing pause",
		description: "How long after you stop typing in the editor the dialog opens.",
	}),
	maxWait: leaf<number | null>({
		id: "typing.maxWait",
		fallback: DEFAULT_TYPING.maxWait,
		decoder: nullable(duration),
		section: "Dialog",
		label: "Typing wait cap",
		description:
			"The longest the dialog waits while you type. Empty waits for as long as you type.",
	}),
};

// Classifiers whose provider has a key. The default stays on the list without one, so the row can
// show it.
function judgeModels(registry: ModelRegistry): string[] {
	const names = registry
		.getModelsOfType("classifier")
		.filter((model) => registry.getProviderAuthStatus(model.provider).configured)
		.map(modelName);
	return [...new Set([DEFAULT_JUDGE.model, ...names])].toSorted((left, right) =>
		left.localeCompare(right),
	);
}

const JUDGE_LEAVES = {
	model: leaf({
		id: "judge.model",
		fallback: DEFAULT_JUDGE.model,
		decoder: trimmedString,
		section: "Judge",
		label: "Model",
		description:
			"Who judges: a classifier model, which answers with a confidence. Jev runs after /login typesafe.",
		control: (ctx) => ({
			type: "choice",
			custom: true,
			options: judgeModels(ctx.modelRegistry).map((value) => ({
				value,
				description: "classifier",
			})),
		}),
	}),
	policy: leaf({
		id: "judge.policy",
		fallback: DEFAULT_JUDGE.policy,
		decoder: string,
		section: "Judge",
		label: "Policy",
		description: "The rules the judge follows, in plain English. Start from a preset and edit it.",
		control: {
			type: "text",
			multiline: true,
			presets: POLICY_PRESETS.filter((preset) => preset.policy !== "").map((preset) => ({
				value: preset.policy,
				label: preset.label,
				description: preset.description,
			})),
		},
	}),
	alwaysAsk: leaf({
		id: "judge.alwaysAsk",
		fallback: DEFAULT_JUDGE.alwaysAsk,
		decoder: stringList("patterns"),
		section: "Judge",
		label: "Always ask me",
		description: 'Patterns the judge never approves, like "git push*".',
	}),
	// The screen builds these two rows itself. That keeps them after the policy, and lets picking a
	// rigor drop the numbers set by hand.
	rigor: hiddenLeaf<JudgeRigor>("judge.rigor", DEFAULT_RIGOR, literal(...JUDGE_RIGORS)),
	dryRun: hiddenLeaf("judge.dryRun", DEFAULT_JUDGE.dryRun, boolean),
	// File only. A threshold or a ceiling set here overrides the rigor.
	allowThreshold: hiddenLeaf("judge.thresholds.allow", DEFAULT_JUDGE.thresholds.allow, unit),
	denyThreshold: hiddenLeaf("judge.thresholds.deny", DEFAULT_JUDGE.thresholds.deny, unit),
	riskCeiling: hiddenLeaf("judge.riskCeiling", DEFAULT_JUDGE.riskCeiling, unit),
	canDeny: hiddenLeaf("judge.canDeny", DEFAULT_JUDGE.canDeny, boolean),
	whenUnsure: hiddenLeaf<JudgeFallback>(
		"judge.whenUnsure",
		DEFAULT_JUDGE.whenUnsure,
		judgeFallback,
	),
	whenItFails: hiddenLeaf<JudgeFallback>(
		"judge.whenItFails",
		DEFAULT_JUDGE.whenItFails,
		judgeFallback,
	),
	noUI: hiddenLeaf("judge.noUI", DEFAULT_JUDGE.noUI, boolean),
	rememberApprovals: hiddenLeaf(
		"judge.rememberApprovals",
		DEFAULT_JUDGE.rememberApprovals,
		boolean,
	),
	timeoutMs: hiddenLeaf("judge.timeoutMs", DEFAULT_JUDGE.timeoutMs, duration),
	cache: hiddenLeaf("judge.cache", DEFAULT_JUDGE.cache, boolean),
};

/** The numbers a rigor stands for, when the settings file sets none of them itself. */
const RIGOR_NUMBERS = [
	JUDGE_LEAVES.allowThreshold,
	JUDGE_LEAVES.denyThreshold,
	JUDGE_LEAVES.riskCeiling,
] as const;

/** The rigor in force, or `custom` when the settings file sets the numbers by hand. */
export function readRigor(scope: SettingsScope): JudgeRigor | "custom" {
	if (RIGOR_NUMBERS.some((entry) => isSetByHand(scope, entry))) return "custom";
	return JUDGE_LEAVES.rigor.get(scope);
}

/** Picks a rigor and drops the numbers set by hand, which would otherwise win over it. */
export function writeRigor(scope: SettingsScope, rigor: JudgeRigor): string | undefined {
	for (const entry of RIGOR_NUMBERS) {
		if (!isSetByHand(scope, entry)) continue;
		const failure = scope.settings.unset(entry, "global");
		if (failure !== undefined) return failure;
	}
	return scope.settings.set(JUDGE_LEAVES.rigor, rigor);
}

export function readDryRun(scope: SettingsScope): boolean {
	return JUDGE_LEAVES.dryRun.get(scope);
}

export function writeDryRun(scope: SettingsScope, dryRun: boolean): string | undefined {
	return scope.settings.set(JUDGE_LEAVES.dryRun, dryRun);
}

export const PERMISSION_SETTINGS: readonly Setting<unknown>[] = [
	...Object.values(PERMISSION_LEAVES),
	...Object.values(JUDGE_LEAVES),
];

/** A fresh object every read, so a caller can mutate it. */
export function readConfig(scope: SettingsScope): PermissionConfig {
	const leaves = PERMISSION_LEAVES;
	const judge = JUDGE_LEAVES;
	const rigor = RIGOR[judge.rigor.get(scope)];

	return {
		allow: [...leaves.allow.get(scope)],
		noUI: leaves.noUI.get(scope),
		notes: leaves.notes.get(scope),
		mode: leaves.mode.get(scope),
		readOnlyBash: leaves.readOnlyBash.get(scope),
		workspace: workspaceOf(scope),
		typing: typingOf(scope),
		mcp: { servers: { ...leaves.servers.get(scope) } },
		judge: {
			model: judge.model.get(scope),
			alwaysAsk: [...judge.alwaysAsk.get(scope)],
			thresholds: {
				allow: byHand(scope, judge.allowThreshold) ?? rigor.thresholds.allow,
				deny: byHand(scope, judge.denyThreshold) ?? rigor.thresholds.deny,
			},
			riskCeiling: byHand(scope, judge.riskCeiling) ?? rigor.riskCeiling,
			whenUnsure: judge.whenUnsure.get(scope),
			canDeny: judge.canDeny.get(scope),
			whenItFails: judge.whenItFails.get(scope),
			noUI: judge.noUI.get(scope),
			dryRun: judge.dryRun.get(scope),
			rememberApprovals: judge.rememberApprovals.get(scope),
			timeoutMs: judge.timeoutMs.get(scope),
			cache: judge.cache.get(scope),
			policy: judge.policy.get(scope),
		},
	};
}

export function writeConfig(scope: SettingsScope, config: PermissionConfig): string | undefined {
	return scope.settings.setAll(toEntries(config));
}

/** The policy one MCP server follows, keeping the others. */
export function setMcpPolicy(
	scope: SettingsScope,
	server: string,
	policy: McpPolicy,
): string | undefined {
	const entry = PERMISSION_LEAVES.servers;
	const servers: Record<string, McpPolicy> = {};
	// A name that pi sanitized one way and a hand edit wrote the other way are one server.
	for (const [name, value] of Object.entries(entry.get(scope))) {
		if (!sameServer(name, server)) servers[name] = value;
	}
	servers[server] = policy;
	return scope.settings.set(entry, servers);
}

/** Moves the 3.x config.json into the shared settings and keeps it as a `.bak`. */
export function migrateConfig(scope: SettingsScope): string[] {
	const path = configPath();
	if (!existsSync(path)) return [];

	const loaded = readLegacyConfig();
	const failure = writeConfig(scope, loaded.config);
	if (failure !== undefined)
		return [...loaded.warnings, `could not move ${path} to the shared settings: ${failure}`];

	const backup = `${path}.bak`;
	try {
		renameSync(path, backup);
	} catch (error) {
		return [...loaded.warnings, `could not keep a copy of ${path}: ${describeError(error)}`];
	}
	return [...loaded.warnings, `moved the config to the shared settings, keeping ${backup}`];
}

// Keys an older version read and this one ignores. Left in the file, they look like they work.
const RETIRED_JUDGE_KEYS: Record<string, string> = {
	enabled: "pick the judge mode with Alt+M, or under New sessions",
	tools: "the judge mode judges every call that is not a read or an edit",
	provider: "the model name picks the provider",
};

/** Removes the retired judge keys from the global file, and says what each one became. */
export function dropRetiredKeys(scope: SettingsScope): string[] {
	const path = scope.settings.globalPath;
	const { data } = readSettingsFile(path);
	const permission = isObject(data.permission) ? data.permission : undefined;
	const judge = isObject(permission?.judge) ? permission.judge : undefined;
	if (permission === undefined || judge === undefined) return [];

	const retired = Object.keys(RETIRED_JUDGE_KEYS).filter((key) => key in judge);
	if (retired.length === 0) return [];

	// In 3.x a judge switched on with no mode meant the judge mode, so new sessions keep starting in it.
	const switchedOn = judge.enabled === true && permission.mode === undefined;
	if (switchedOn) permission.mode = "judge";
	for (const key of retired) delete judge[key];

	try {
		writeSettingsFile(path, data);
	} catch (error) {
		return [`could not remove the retired judge keys from ${path}: ${describeError(error)}`];
	}
	scope.settings.load(scope.settings.projectPath);

	const lines = retired.map((key) => `removed judge.${key}, ${RETIRED_JUDGE_KEYS[key]}`);
	if (switchedOn) lines.push("new sessions start in the judge mode, as judge.enabled said");
	return lines;
}

function isSetByHand(scope: SettingsScope, entry: Setting<unknown>): boolean {
	return scope.settings.layer(entry) !== "default";
}

function byHand<T>(scope: SettingsScope, entry: Setting<T>): T | undefined {
	return isSetByHand(scope, entry) ? entry.get(scope) : undefined;
}

function workspaceOf(scope: SettingsScope): WorkspaceConfig {
	return {
		roots: [...PERMISSION_LEAVES.roots.get(scope)],
		outside: PERMISSION_LEAVES.outside.get(scope),
	};
}

function typingOf(scope: SettingsScope): TypingConfig {
	return {
		pause: PERMISSION_LEAVES.pause.get(scope),
		maxWait: PERMISSION_LEAVES.maxWait.get(scope),
	};
}

function toEntries(config: PermissionConfig): (readonly [Setting<unknown>, unknown])[] {
	const leaves = PERMISSION_LEAVES;
	const judge = JUDGE_LEAVES;
	return [
		[leaves.allow, config.allow],
		[leaves.noUI, config.noUI],
		[leaves.notes, config.notes],
		[leaves.mode, config.mode],
		[leaves.readOnlyBash, config.readOnlyBash],
		[leaves.roots, config.workspace.roots],
		[leaves.outside, config.workspace.outside],
		[leaves.servers, config.mcp.servers],
		[leaves.pause, config.typing.pause],
		[leaves.maxWait, config.typing.maxWait],
		[judge.model, config.judge.model],
		[judge.alwaysAsk, config.judge.alwaysAsk],
		[judge.allowThreshold, config.judge.thresholds.allow],
		[judge.denyThreshold, config.judge.thresholds.deny],
		[judge.riskCeiling, config.judge.riskCeiling],
		[judge.whenUnsure, config.judge.whenUnsure],
		[judge.canDeny, config.judge.canDeny],
		[judge.whenItFails, config.judge.whenItFails],
		[judge.noUI, config.judge.noUI],
		[judge.dryRun, config.judge.dryRun],
		[judge.rememberApprovals, config.judge.rememberApprovals],
		[judge.timeoutMs, config.judge.timeoutMs],
		[judge.cache, config.judge.cache],
		[judge.policy, config.judge.policy],
	];
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

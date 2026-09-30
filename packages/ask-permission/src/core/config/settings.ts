// One setting per leaf of the config. `readConfig` builds the nested config back.
import { existsSync, renameSync } from "node:fs";

import {
	boolean,
	type Control,
	type Decoder,
	duration,
	literal,
	nullable,
	type Setting,
	setting,
	type SettingsScope,
	type SettingUi,
	string,
	stringList,
	trimmedString,
	unit,
} from "@adeildo/pi-kit";

import { mode, type NoUIConfig, noUI, mcpServers } from "#core/config/decode.ts";
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
import {
	DEFAULT_JUDGE,
	JEV_MODELS,
	type JudgeBackendId,
	type JudgeFallback,
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

/** A setting with no row of its own: the screen builds one row per server. */
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

const FALLBACK_CONTROL: Control = {
	type: "choice",
	options: [
		{ value: "ask", label: "ask me" },
		{ value: "allow", label: "allow" },
		{ value: "deny", label: "deny" },
	],
};

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
	servers: hiddenLeaf<Record<string, McpPolicy>>("mcp.servers", {}, mcpServers),
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

const JUDGE_LEAVES = {
	provider: leaf<JudgeBackendId>({
		id: "judge.provider",
		fallback: DEFAULT_JUDGE.provider,
		decoder: literal("jev", "pi"),
		section: "Judge",
		label: "Provider",
		description: "Who judges. Jev is fast and answers with a confidence.",
		control: {
			type: "choice",
			options: [
				{
					value: "jev",
					label: "Jev",
					description: "TypeSafe's judge model, after /login typesafe",
				},
				{ value: "pi", label: "a pi model", description: "any model you set up in pi" },
			],
		},
	}),
	model: leaf({
		id: "judge.model",
		fallback: DEFAULT_JUDGE.model,
		decoder: trimmedString,
		section: "Judge",
		label: "Model",
		description: "A Jev alias for Jev, provider/model for a pi model.",
		control: (ctx) => ({
			type: "choice",
			custom: true,
			options: [
				...JEV_MODELS.map((value) => ({ value, description: "Jev" })),
				...ctx.modelRegistry
					.getAvailable()
					.map((model) => `${model.provider}/${model.id}`)
					.toSorted((left, right) => left.localeCompare(right))
					.map((value) => ({ value, description: "pi model" })),
			],
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
	canDeny: leaf({
		id: "judge.canDeny",
		fallback: DEFAULT_JUDGE.canDeny,
		decoder: boolean,
		section: "Judge",
		label: "Can deny",
		description: "A confident no blocks the call. Off, it comes to you.",
	}),
	whenUnsure: leaf<JudgeFallback>({
		id: "judge.whenUnsure",
		fallback: DEFAULT_JUDGE.whenUnsure,
		decoder: literal("ask", "allow", "deny"),
		section: "Judge",
		label: "When unsure",
		description: "What happens when the judge is not confident either way.",
		control: FALLBACK_CONTROL,
	}),
	whenItFails: leaf<JudgeFallback>({
		id: "judge.whenItFails",
		fallback: DEFAULT_JUDGE.whenItFails,
		decoder: literal("ask", "allow", "deny"),
		section: "Judge",
		label: "When it fails",
		description: "What happens on a timeout, an error or a missing key.",
		control: FALLBACK_CONTROL,
	}),
	alwaysAsk: leaf({
		id: "judge.alwaysAsk",
		fallback: DEFAULT_JUDGE.alwaysAsk,
		decoder: stringList("patterns"),
		section: "Judge",
		label: "Always ask me",
		description: 'Patterns the judge never approves, like "git push*".',
	}),
	allowThreshold: leaf({
		id: "judge.thresholds.allow",
		fallback: DEFAULT_JUDGE.thresholds.allow,
		decoder: unit,
		section: "Judge",
		label: "Confidence to allow",
		description: "How sure the judge has to be before a call runs.",
	}),
	denyThreshold: leaf({
		id: "judge.thresholds.deny",
		fallback: DEFAULT_JUDGE.thresholds.deny,
		decoder: unit,
		section: "Judge",
		label: "Confidence to deny",
		description: "How sure the judge has to be before it blocks a call.",
	}),
	riskCeiling: leaf({
		id: "judge.riskCeiling",
		fallback: DEFAULT_JUDGE.riskCeiling,
		decoder: unit,
		section: "Judge",
		label: "Risk ceiling",
		description: "Above this risk the call comes to you, however sure the judge is.",
	}),
	dryRun: leaf({
		id: "judge.dryRun",
		fallback: DEFAULT_JUDGE.dryRun,
		decoder: boolean,
		section: "Judge",
		label: "Dry run",
		description: "The judge shows its verdict, and you still decide.",
	}),
	noUI: leaf({
		id: "judge.noUI",
		fallback: DEFAULT_JUDGE.noUI,
		decoder: boolean,
		section: "Judge",
		label: "Judge with no dialog",
		description: "Also judge print, JSON and subagent runs.",
	}),
	rememberApprovals: leaf({
		id: "judge.rememberApprovals",
		fallback: DEFAULT_JUDGE.rememberApprovals,
		decoder: boolean,
		section: "Judge",
		label: "Remember approvals",
		description: "A judge approval becomes always yes for this session.",
	}),
	timeoutMs: leaf({
		id: "judge.timeoutMs",
		fallback: DEFAULT_JUDGE.timeoutMs,
		decoder: duration,
		section: "Judge",
		label: "Timeout",
		description: "How long to wait for the judge before the call comes to you.",
	}),
	cache: leaf({
		id: "judge.cache",
		fallback: DEFAULT_JUDGE.cache,
		decoder: boolean,
		section: "Judge",
		label: "Cache",
		description: "Reuse a verdict for the same call in one session.",
	}),
};

export const PERMISSION_SETTINGS: readonly Setting<unknown>[] = [
	...Object.values(PERMISSION_LEAVES),
	...Object.values(JUDGE_LEAVES),
];

/** A fresh object every read, so a caller can mutate it. */
export function readConfig(scope: SettingsScope): PermissionConfig {
	const leaves = PERMISSION_LEAVES;
	const judge = JUDGE_LEAVES;

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
			provider: judge.provider.get(scope),
			model: judge.model.get(scope),
			alwaysAsk: [...judge.alwaysAsk.get(scope)],
			thresholds: { allow: judge.allowThreshold.get(scope), deny: judge.denyThreshold.get(scope) },
			riskCeiling: judge.riskCeiling.get(scope),
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
		[judge.provider, config.judge.provider],
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

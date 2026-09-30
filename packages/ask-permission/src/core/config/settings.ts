// One setting per leaf of the config, so any settings screen can list them. `readConfig` builds the
// nested config back from them.
import { existsSync, renameSync } from "node:fs";

import {
	boolean,
	type Decoder,
	duration,
	literal,
	nullable,
	type Setting,
	setting,
	type SettingsScope,
	string,
	stringList,
	trimmedString,
	unit,
} from "@adeildo/pi-kit";

import { mode, type NoUIConfig, noUI } from "#core/config/decode.ts";
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
import { DEFAULT_JUDGE, type JudgeBackendId, type JudgeFallback } from "#core/judge/config.ts";
import { DEFAULT_MODE, type PermissionMode } from "#core/mode.ts";

const PERMISSION = "Permission";
const JUDGE = "Permission judge";

function leaf<T>(
	id: string,
	fallback: T,
	decoder: Decoder<T>,
	label: string,
	description: string,
	ui = PERMISSION,
): Setting<T> {
	return setting({
		id: `permission.${id}`,
		default: fallback,
		decoder,
		ui: { group: ui, label, description },
	});
}

const PERMISSION_LEAVES = {
	allow: leaf(
		"allow",
		DEFAULT_CONFIG.allow,
		stringList("tool names"),
		"Allowed tools",
		"Tools that run without asking.",
	),
	noUI: leaf<NoUIConfig>(
		"noUI",
		DEFAULT_CONFIG.noUI,
		noUI,
		"Without a dialog",
		'What to do when there is no dialog to ask in: "allow", "deny", or a map per tool.',
	),
	notes: leaf<NoteDelivery>(
		"notes",
		DEFAULT_CONFIG.notes,
		literal("result", "message"),
		"Note delivery",
		'"result" attaches your note to the tool result, "message" sends it as a message.',
	),
	mode: leaf<PermissionMode>(
		"mode",
		DEFAULT_MODE,
		mode,
		"Default mode",
		"The mode a new session starts in.",
	),
	readOnlyBash: leaf(
		"readOnlyBash",
		DEFAULT_CONFIG.readOnlyBash,
		boolean,
		"Read-only bash",
		"Let commands that only read run without asking.",
	),
	roots: leaf(
		"workspace.roots",
		DEFAULT_WORKSPACE.roots,
		stringList("paths"),
		"Workspace roots",
		"Paths the project is made of.",
	),
	outside: leaf<OutsideScope>(
		"workspace.outside",
		DEFAULT_WORKSPACE.outside,
		literal("ask", "deny", "allow"),
		"Default outside policy",
		"What a new session does with a call outside the roots. Alt+W changes it for one session.",
	),
	pause: leaf(
		"typing.pause",
		DEFAULT_TYPING.pause,
		duration,
		"Typing pause",
		"How long after you stop typing the dialog opens.",
	),
	maxWait: leaf<number | null>(
		"typing.maxWait",
		DEFAULT_TYPING.maxWait,
		nullable(duration),
		"Typing wait cap",
		"Longest the dialog waits while you type. Empty means no cap.",
	),
};

const JUDGE_LEAVES = {
	provider: leaf<JudgeBackendId>(
		"judge.provider",
		DEFAULT_JUDGE.provider,
		literal("jev", "pi"),
		"Judge backend",
		'"jev" asks TypeSafe, "pi" asks the model you are already using.',
		JUDGE,
	),
	model: leaf(
		"judge.model",
		DEFAULT_JUDGE.model,
		trimmedString,
		"Judge model",
		"A Jev alias, or provider/modelId for the pi backend.",
		JUDGE,
	),
	alwaysAsk: leaf(
		"judge.alwaysAsk",
		DEFAULT_JUDGE.alwaysAsk,
		stringList("patterns"),
		"Always ask me",
		"Tool patterns that skip the judge and come to you.",
		JUDGE,
	),
	allowThreshold: leaf(
		"judge.thresholds.allow",
		DEFAULT_JUDGE.thresholds.allow,
		unit,
		"Judge confidence to allow",
		"How sure the judge has to be before a call runs.",
		JUDGE,
	),
	denyThreshold: leaf(
		"judge.thresholds.deny",
		DEFAULT_JUDGE.thresholds.deny,
		unit,
		"Judge confidence to deny",
		"How sure the judge has to be before it blocks a call on its own.",
		JUDGE,
	),
	riskCeiling: leaf(
		"judge.riskCeiling",
		DEFAULT_JUDGE.riskCeiling,
		unit,
		"Risk ceiling",
		"Above this risk the call comes to you, however sure the judge is.",
		JUDGE,
	),
	whenUnsure: leaf<JudgeFallback>(
		"judge.whenUnsure",
		DEFAULT_JUDGE.whenUnsure,
		literal("ask", "allow", "deny"),
		"When the judge is unsure",
		"What to do near the thresholds.",
		JUDGE,
	),
	canDeny: leaf(
		"judge.canDeny",
		DEFAULT_JUDGE.canDeny,
		boolean,
		"Judge may deny",
		"Let the judge block a call instead of asking you.",
		JUDGE,
	),
	whenItFails: leaf<JudgeFallback>(
		"judge.whenItFails",
		DEFAULT_JUDGE.whenItFails,
		literal("ask", "allow", "deny"),
		"When the judge fails",
		"What to do when the judge errors or times out.",
		JUDGE,
	),
	noUI: leaf(
		"judge.noUI",
		DEFAULT_JUDGE.noUI,
		boolean,
		"Judge without a dialog",
		"Run the judge even where there is nobody to ask.",
		JUDGE,
	),
	dryRun: leaf(
		"judge.dryRun",
		DEFAULT_JUDGE.dryRun,
		boolean,
		"Judge dry run",
		"Ask the judge and log the verdict, deciding nothing.",
		JUDGE,
	),
	rememberApprovals: leaf(
		"judge.rememberApprovals",
		DEFAULT_JUDGE.rememberApprovals,
		boolean,
		"Remember judge approvals",
		"Treat an always-yes as a rule for the judge later.",
		JUDGE,
	),
	timeoutMs: leaf(
		"judge.timeoutMs",
		DEFAULT_JUDGE.timeoutMs,
		duration,
		"Judge timeout",
		"How long to wait before the call comes to you.",
		JUDGE,
	),
	cache: leaf(
		"judge.cache",
		DEFAULT_JUDGE.cache,
		boolean,
		"Judge cache",
		"Reuse a verdict for the same call in one session.",
		JUDGE,
	),
	policy: leaf(
		"judge.policy",
		DEFAULT_JUDGE.policy,
		string,
		"Judge policy",
		"The rulebook the judge reads. Plain English.",
		JUDGE,
	),
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

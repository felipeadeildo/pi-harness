import type { FeatureScope } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Key } from "@earendil-works/pi-tui";

import { type Scope, SCOPE_LABEL } from "#core/always-yes.ts";
import { isOutsideScope } from "#core/config/schema.ts";
import { TYPESAFE_PROVIDER } from "#core/judge/backends/jev.ts";
import { probeJudge } from "#core/judge/probe.ts";
import { judgeLogText } from "#core/judge/report.ts";
import { MODES, nextMode, parseMode, PERMISSION_MODES } from "#core/mode.ts";
import { OUTSIDE_DESCRIPTION, OUTSIDE_SCOPES, toggleOutside } from "#core/workspace.ts";
import { NAME } from "#identity";
import { setSessionMode, setSessionOutside } from "#pi/mode.ts";
import { forgetAlwaysYes, resetJudgeHealth, saveConfig, type SessionState } from "#pi/session.ts";
import { alwaysYesCount, openSettings } from "#ui/settings/screen.ts";
import { statusText } from "#ui/settings/status.ts";

const JUDGE_STATUS = `${NAME}:judge`;

export function registerCommands(scope: FeatureScope, state: SessionState): void {
	const openSettingsFor = (ctx: ExtensionContext): Promise<void> =>
		openSettings(ctx, {
			config: state.config,
			alwaysYes: state.alwaysYes,
			mode: () => state.mode,
			setMode: (mode) => setSessionMode(scope, state, mode, ctx, false),
			outside: () => state.outside,
			setOutside: (outside) => setSessionOutside(scope, state, outside, ctx, false),
			save: () => saveConfig(scope, state, ctx),
			onJudgeChange: () => state.judgeCache.clear(),
		});

	function notifyStatus(ctx: ExtensionContext): void {
		ctx.ui.notify(statusText(state, state.alwaysYes, ctx.cwd), "info");
	}

	function cycleMode(ctx: ExtensionContext): void {
		setSessionMode(scope, state, nextMode(state.mode), ctx);
	}

	function toggleOutsideScope(ctx: ExtensionContext): void {
		setSessionOutside(scope, state, toggleOutside(state.outside), ctx);
	}

	async function runJudgeProbe(ctx: ExtensionContext): Promise<void> {
		ctx.ui.setStatus(JUDGE_STATUS, "judge: testing\u2026");
		const auth = ctx.modelRegistry.getProviderAuthStatus(TYPESAFE_PROVIDER);
		const probe = await probeJudge(
			state.config.judge,
			{
				resolveApiKey: () => ctx.modelRegistry.getApiKeyForProvider(TYPESAFE_PROVIDER),
				modelRegistry: ctx.modelRegistry,
			},
			ctx.signal,
		).finally(() => ctx.ui.setStatus(JUDGE_STATUS, undefined));

		if (!probe.ok) {
			const source = auth.configured
				? `key from ${auth.label ?? auth.source}`
				: "no key configured";
			const suffix = state.config.judge.provider === "jev" ? ` (${source})` : "";
			ctx.ui.notify(`${NAME}: judge test failed: ${probe.detail}${suffix}`, "error");
			return;
		}

		resetJudgeHealth(state);

		const summary = `judge test ok \u00b7 ${probe.model ?? state.config.judge.model} \u00b7 ${probe.elapsedMs}ms`;
		if (probe.elapsedMs > state.config.judge.timeoutMs) {
			ctx.ui.notify(
				`${NAME}: ${summary}. Slower than the ${state.config.judge.timeoutMs}ms timeout, raise judge.timeoutMs`,
				"warning",
			);
			return;
		}

		ctx.ui.notify(`${NAME}: ${summary}`, "info");
	}

	async function judgeCommand(ctx: ExtensionContext, argument: string | undefined): Promise<void> {
		if (argument === "log") {
			ctx.ui.notify(judgeLogText(state.judgeLog), "info");
			return;
		}

		if (argument === "test") {
			await runJudgeProbe(ctx);
			return;
		}

		await settingsOrStatus(ctx);
	}

	function modeCommand(ctx: ExtensionContext, argument: string | undefined): void {
		if (argument === undefined) {
			cycleMode(ctx);
			return;
		}

		const mode = parseMode(argument);
		if (!mode) {
			ctx.ui.notify(`${NAME}: mode takes ${PERMISSION_MODES.join(", ")}`, "warning");
			return;
		}

		setSessionMode(scope, state, mode, ctx);
	}

	function outsideCommand(ctx: ExtensionContext, argument: string | undefined): void {
		if (argument === undefined) {
			toggleOutsideScope(ctx);
			return;
		}
		if (!isOutsideScope(argument)) {
			ctx.ui.notify(`${NAME}: outside takes ${OUTSIDE_SCOPES.join(", ")}`, "warning");
			return;
		}
		setSessionOutside(scope, state, argument, ctx);
	}

	function forgetCommand(ctx: ExtensionContext, argument = "session"): void {
		const level = FORGET_SCOPES[argument];
		if (!level) {
			ctx.ui.notify(`${NAME}: forget takes ${Object.keys(FORGET_SCOPES).join(", ")}`, "warning");
			return;
		}

		const where = level === "all" ? "every scope" : SCOPE_LABEL[level];
		const removed = alwaysYesCount(forgetAlwaysYes(scope, state, ctx, level));
		ctx.ui.notify(`${NAME}: forgot ${removed} from ${where}`, "info");
	}

	async function settingsOrStatus(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode === "tui") await openSettingsFor(ctx);
		else notifyStatus(ctx);
	}

	scope.registerCommand("perm", {
		description: `${NAME}: settings, mode, outside, status, forget, judge`,
		getArgumentCompletions: (prefix) => {
			const typed = prefix.trimStart().toLowerCase();
			const matches = SUBCOMMANDS.filter((command) => command.value.startsWith(typed));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const [verb, argument] = args.trim().toLowerCase().split(/\s+/);

			switch (verb) {
				case "":
					await settingsOrStatus(ctx);
					return;
				case "mode":
					modeCommand(ctx, argument);
					return;
				case "outside":
					outsideCommand(ctx, argument);
					return;
				case "status":
					notifyStatus(ctx);
					return;
				case "forget":
					forgetCommand(ctx, argument);
					return;
				case "judge":
					await judgeCommand(ctx, argument);
					return;
				default:
					ctx.ui.notify(`${NAME}: /perm takes ${VERBS.join(", ")}`, "warning");
			}
		},
	});

	scope.registerShortcut(Key.alt("m"), {
		description: `${NAME}: cycle mode (${PERMISSION_MODES.join(", ")})`,
		handler: cycleMode,
	});

	scope.registerShortcut(Key.alt("w"), {
		description: `${NAME}: ask or allow calls outside the workspace, this session`,
		handler: toggleOutsideScope,
	});
}

const FORGET_SCOPES: Record<string, Scope | "all"> = {
	session: "session",
	project: "project",
	everywhere: "global",
	all: "all",
};

const SUBCOMMANDS: AutocompleteItem[] = [
	suggestion("mode", "Switch to the next mode (also Alt+M)"),
	...PERMISSION_MODES.map((mode) => suggestion(`mode ${mode}`, MODES[mode].description)),
	suggestion("outside", "Ask or allow calls outside the workspace, this session (also Alt+W)"),
	...OUTSIDE_SCOPES.map((outside) =>
		suggestion(`outside ${outside}`, OUTSIDE_DESCRIPTION[outside]),
	),
	suggestion("status", "Show the config, always yes, and file paths"),
	suggestion("forget", "Forget this session's always yes"),
	suggestion("forget project", "Forget this project's always yes"),
	suggestion("forget everywhere", "Forget the always yes that applies everywhere"),
	suggestion("forget all", "Forget every always yes"),
	suggestion("judge log", "Show this session's judge decisions"),
	suggestion("judge test", "Send one real request and report the result"),
];

function suggestion(value: string, description: string): AutocompleteItem {
	return { value, label: value, description };
}

const VERBS = ["mode", "outside", "status", "forget", "judge"];

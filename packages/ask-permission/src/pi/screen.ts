import type { FeatureScope } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Scope, SCOPE_LABEL } from "#core/always-yes.ts";
import { isOutsideScope } from "#core/config/schema.ts";
import { MODE_CONTROL, OUTSIDE_CONTROL } from "#core/config/settings.ts";
import { globalAlwaysYesPath, projectAlwaysYesPath } from "#core/config/store.ts";
import { TYPESAFE_PROVIDER } from "#core/judge/backends/jev.ts";
import { probeJudge } from "#core/judge/probe.ts";
import { judgeLogText } from "#core/judge/report.ts";
import { parseMode } from "#core/mode.ts";
import { shortenHome } from "#core/tools.ts";
import { setSessionMode, setSessionOutside } from "#pi/mode.ts";
import { forgetAlwaysYes, resetJudgeHealth, type SessionState } from "#pi/session.ts";

export function registerScreen(scope: FeatureScope, state: SessionState): void {
	scope.screen.value({
		id: "session.mode",
		section: "This session",
		label: "Mode",
		description: "Which calls run without asking, until the session ends. Alt+M cycles it.",
		control: MODE_CONTROL,
		get: () => state.mode,
		set: (value, ctx) => {
			const mode = typeof value === "string" ? parseMode(value) : undefined;
			if (mode === undefined) return "not a mode";
			setSessionMode(scope, state, mode, ctx, false);
			return undefined;
		},
	});

	scope.screen.value({
		id: "session.outside",
		section: "This session",
		label: "Outside the workspace",
		description: "What a call outside the workspace does, until the session ends. Alt+W flips it.",
		control: OUTSIDE_CONTROL,
		get: () => state.outside,
		set: (value, ctx) => {
			if (!isOutsideScope(value)) return "not an outside policy";
			setSessionOutside(scope, state, value, ctx, false);
			return undefined;
		},
	});

	scope.screen.action({
		id: "judge.test",
		section: "Judge",
		label: "Test the judge",
		description:
			"Sends one real request with the settings above, and reports the model and the time.",
		run: (ctx) => testJudge(state, ctx),
	});

	scope.screen.action({
		id: "judge.log",
		section: "Judge",
		label: "This session's verdicts",
		description: "The last calls the judge decided in this session.",
		text: () => (state.judgeLog.length === 0 ? "none yet" : `${state.judgeLog.length}`),
		run: () => judgeLogText(state.judgeLog),
	});

	for (const where of ["session", "project", "global"] as const) {
		scope.screen.action({
			id: `always-yes.${where}`,
			section: "Always yes",
			label: capitalize(SCOPE_LABEL[where]),
			description: alwaysYesDescription(where),
			text: () => count(state.alwaysYes.size(where)),
			confirm: `Forget every always yes for ${SCOPE_LABEL[where]}?`,
			run: (ctx) => forget(scope, state, ctx, where),
		});
	}
}

async function testJudge(state: SessionState, ctx: ExtensionContext): Promise<string> {
	const judge = state.config.judge;
	const probe = await probeJudge(
		judge,
		{
			resolveApiKey: () => ctx.modelRegistry.getApiKeyForProvider(TYPESAFE_PROVIDER),
			modelRegistry: ctx.modelRegistry,
		},
		ctx.signal,
	);

	if (!probe.ok) {
		const auth = ctx.modelRegistry.getProviderAuthStatus(TYPESAFE_PROVIDER);
		const key = auth.configured
			? `key from ${auth.label ?? auth.source}`
			: "no key, run /login typesafe";
		throw new Error(
			`the judge failed: ${probe.detail}${judge.provider === "jev" ? ` (${key})` : ""}`,
		);
	}

	resetJudgeHealth(state);
	const lines = [`The judge answered in ${probe.elapsedMs}ms, with ${probe.model ?? judge.model}.`];
	if (probe.elapsedMs > judge.timeoutMs) {
		lines.push(
			"",
			`That is slower than the ${judge.timeoutMs}ms timeout, so real calls would come to you. Raise the timeout.`,
		);
	}
	return lines.join("\n");
}

function forget(
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	where: Scope,
): string | undefined {
	const removed = forgetAlwaysYes(scope, state, ctx, where);
	if (removed === 0) throw new Error(`nothing to forget for ${SCOPE_LABEL[where]}`);
	return undefined;
}

function alwaysYesDescription(where: Scope): string {
	switch (where) {
		case "session":
			return "Rules for this session. Enter forgets them.";
		case "project":
			return `Rules for this project, in ${projectAlwaysYesPath(".")}. Enter forgets them.`;
		case "global":
			return `Rules for every project, in ${shortenHome(globalAlwaysYesPath())}. Enter forgets them.`;
	}
}

function count(size: number): string {
	return size === 1 ? "1 rule" : `${size} rules`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

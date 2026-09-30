import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { OutsideScope } from "#core/config/schema.ts";
import { policyWarning } from "#core/judge/policy.ts";
import { MODES, type PermissionMode } from "#core/mode.ts";
import { OUTSIDE_DESCRIPTION } from "#core/workspace.ts";
import { NAME } from "#identity";
import { record } from "#pi/session-entries.ts";
import type { SessionState } from "#pi/session.ts";

export const MODE_STATUS = `${NAME}:mode`;

const ARROW: Record<PermissionMode, string> = {
	manual: "",
	edits: "\u23f5 ",
	judge: "\u23f5 ",
	full: "\u23f5\u23f5 ",
};

const OUTSIDE_TAG: Record<OutsideScope, string | undefined> = {
	ask: undefined,
	allow: "anywhere",
	deny: "workspace only",
};

export function setSessionMode(
	pi: ExtensionAPI,
	state: SessionState,
	mode: PermissionMode,
	ctx: ExtensionContext,
	announce = true,
): void {
	if (mode !== state.mode) record(pi, { kind: "mode", mode });
	state.mode = mode;
	renderStatus(ctx, state);

	if (!announce) return;
	ctx.ui.notify(`${NAME}: ${mode} \u00b7 ${MODES[mode].description}`, "info");
	notifyJudgePolicyWarning(state, ctx);
}

export function setSessionOutside(
	pi: ExtensionAPI,
	state: SessionState,
	outside: OutsideScope,
	ctx: ExtensionContext,
	announce = true,
): void {
	if (outside !== state.outside) record(pi, { kind: "outside", outside });
	state.outside = outside;
	renderStatus(ctx, state);

	if (!announce) return;
	ctx.ui.notify(`${NAME}: outside ${outside} \u00b7 ${OUTSIDE_DESCRIPTION[outside]}`, "info");
}

export function notifyJudgePolicyWarning(
	state: Pick<SessionState, "config" | "mode">,
	ctx: ExtensionContext,
): void {
	if (state.mode !== "judge") return;
	const warning = policyWarning(state.config.judge.policy);
	if (warning) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
}

export function clearStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(MODE_STATUS, undefined);
}

export function renderStatus(
	ctx: ExtensionContext,
	state: Pick<SessionState, "mode" | "outside">,
): void {
	const tag = OUTSIDE_TAG[state.outside];
	if (state.mode === "manual" && tag === undefined) {
		clearStatus(ctx);
		return;
	}
	if (!ctx.hasUI) return;

	const label = tag === undefined ? state.mode : `${state.mode} \u00b7 ${tag}`;
	const color = state.outside === "allow" ? "error" : "warning";
	ctx.ui.setStatus(MODE_STATUS, ctx.ui.theme.fg(color, `${ARROW[state.mode]}${label}`));
}

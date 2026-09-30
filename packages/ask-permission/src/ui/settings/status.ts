import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type AlwaysYes, SCOPE_LABEL, SCOPES } from "#core/always-yes.ts";
import type { OutsideScope, PermissionConfig } from "#core/config/schema.ts";
import { configPath, globalAlwaysYesPath, projectAlwaysYesPath } from "#core/config/store.ts";
import { policyWarning } from "#core/judge/policy.ts";
import type { PermissionMode } from "#core/mode.ts";
import { NAME } from "#identity";

export interface StatusState {
	config: PermissionConfig;
	mode: PermissionMode;
	outside: OutsideScope;
}

export function notifyJudgePolicyWarning(state: StatusState, ctx: ExtensionContext): void {
	if (state.mode !== "judge") return;

	const warning = policyWarning(state.config.judge.policy);
	if (warning) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
}

export function statusText(state: StatusState, alwaysYes: AlwaysYes, cwd: string): string {
	const { config } = state;
	const noUI = typeof config.noUI === "string" ? config.noUI : JSON.stringify(config.noUI);

	return [
		`${NAME} \u00b7 ${configPath()}`,
		`this session: mode ${state.mode} \u00b7 outside ${state.outside}`,
		`new sessions: mode ${config.mode} \u00b7 outside ${config.workspace.outside}`,
		`allow: ${config.allow.join(", ") || "(none)"}`,
		`notes: ${config.notes} \u00b7 noUI: ${noUI}`,
		`typing: pause ${config.typing.pause}ms \u00b7 maxWait ${config.typing.maxWait ?? "none"}`,
		`readOnlyBash: ${config.readOnlyBash ? "on" : "off"}`,
		`workspace: ${config.workspace.roots.join(", ")}`,
		judgeLine(config),
		`always yes: ${SCOPES.map((scope) => `${alwaysYes.size(scope)} ${SCOPE_LABEL[scope]}`).join(" \u00b7 ")}`,
		`always yes for this project: ${projectAlwaysYesPath(cwd)}`,
		`always yes everywhere: ${globalAlwaysYesPath()}`,
	].join("\n");
}

function judgeLine(config: PermissionConfig): string {
	const judge = config.judge;
	const tags = [
		judge.dryRun ? "dry run" : undefined,
		judge.canDeny ? undefined : "cannot deny",
		judge.noUI ? "no UI" : undefined,
		judge.policy.trim() === "" ? "no policy" : "policy set",
	].filter((tag): tag is string => tag !== undefined);

	return `judge: ${judge.provider}/${judge.model} \u00b7 ${tags.join(" \u00b7 ")}`;
}

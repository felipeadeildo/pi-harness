// The first layer with an answer decides, so the order is the policy. The caller adds the judge.
import type { AlwaysYes } from "#core/always-yes.ts";
import { isAllowed } from "#core/config/patterns.ts";
import type { OutsideScope, PermissionConfig } from "#core/config/schema.ts";
import type { Access, OpenFolders } from "#core/folders.ts";
import { MODES, type ModeRules, type PermissionMode } from "#core/mode.ts";
import {
	asToolInput,
	type CallDescriptor,
	type CustomTools,
	shortenHome,
	type ToolAdapter,
	toolAdapter,
	type ToolInput,
} from "#core/tools.ts";
import { type Reach, reachOf } from "#core/workspace.ts";
import { NAME } from "#identity";

export interface Call {
	toolName: string;
	input: ToolInput;
	target: CallDescriptor;
	tool: ToolAdapter;
	reach: Reach;
}

export type Verdict =
	| { action: "allow" }
	| { action: "block"; reason: string }
	| { action: "ask"; reason?: string };

export type Decision = (Verdict & { by: string }) | { action: "ask" };

export interface Layer {
	name: string;
	decide(call: Call): Verdict | undefined | Promise<Verdict | undefined>;
}

export interface GateState {
	config: PermissionConfig;
	mode: PermissionMode;
	outside: OutsideScope;
	alwaysYes: Pick<AlwaysYes, "has">;
	folders: Pick<OpenFolders, "covers">;
}

const ALLOW: Verdict = { action: "allow" };

export function describeCall(
	toolName: string,
	rawInput: unknown,
	cwd: string,
	config: PermissionConfig,
	custom?: CustomTools,
): Call {
	const input = asToolInput(rawInput);
	const tool = toolAdapter(toolName, custom);
	const reach = reachOf(config.workspace.roots, cwd, tool.paths(input));
	return { toolName, input, tool, target: tool.describe(input), reach };
}

export function gateLayers(state: GateState): Layer[] {
	const rules = MODES[state.mode];
	return [
		{
			name: "always yes",
			decide: (call) =>
				state.alwaysYes.has(call.toolName, call.target.levels) ? ALLOW : undefined,
		},
		{
			name: "workspace",
			decide: (call) => workspaceVerdict(call, rules, state),
		},
		{
			name: "mode",
			decide: (call) =>
				rules.everything || (rules.edits && call.tool.edits === true) ? ALLOW : undefined,
		},
		{
			name: "allow list",
			decide: (call) => (isAllowed(state.config, call.toolName) ? ALLOW : undefined),
		},
		{
			name: "read-only bash",
			decide: (call) => (isReadOnlyBash(call, state) ? ALLOW : undefined),
		},
	];
}

export async function decide(call: Call, layers: Layer[]): Promise<Decision> {
	for (const layer of layers) {
		// oxlint-disable-next-line no-await-in-loop -- a layer runs only when the earlier ones passed.
		const verdict = await layer.decide(call);
		if (verdict) return { ...verdict, by: layer.name };
	}
	return { action: "ask" };
}

/** What the call does where it lands: a read-only call only reads. */
export function accessOf(call: Call): Access {
	if (call.tool.onlyReads === true) return "read";
	return call.tool.readOnly?.(call.input) === true ? "read" : "write";
}

// Asking here keeps the judge from approving a call that left.
function workspaceVerdict(
	call: Call,
	rules: ModeRules,
	state: Pick<GateState, "outside" | "folders">,
): Verdict | undefined {
	if (call.reach.kind === "outside") {
		const access = accessOf(call);
		if (call.reach.paths.every((path) => state.folders.covers(path, access))) return undefined;
	}

	const reason = leavingReason(call.reach, rules);
	if (reason === undefined || state.outside === "allow") return undefined;
	if (state.outside === "deny") return { action: "block", reason: `${NAME}: ${reason}` };
	return { action: "ask", reason };
}

function leavingReason(reach: Reach, rules: ModeRules): string | undefined {
	switch (reach.kind) {
		case "inside":
			return undefined;
		case "outside":
			return `outside the workspace (${shortenHome(reach.path)})`;
		case "unknown":
			return rules.unknownIsOutside ? "cannot tell which paths this command reaches" : undefined;
	}
}

// `cat "$HOME/.ssh/id_rsa"` only reads, but nothing here can tell what. The judge decides it.
function isReadOnlyBash(call: Call, state: GateState): boolean {
	if (!state.config.readOnlyBash) return false;
	if (call.reach.kind === "unknown" && state.outside !== "allow") return false;
	return call.tool.readOnly?.(call.input) === true;
}

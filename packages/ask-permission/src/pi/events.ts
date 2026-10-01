import { canAsk, type FeatureScope } from "@adeildo/pi-kit";
import {
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import { SCOPE_LABEL } from "#core/always-yes.ts";
import type { DialogAnswer, FolderOffer } from "#core/answer.ts";
import { noUIMode } from "#core/config/patterns.ts";
import {
	accessOf,
	type Call,
	decide,
	describeCall,
	gateLayers,
	type Verdict,
} from "#core/decide.ts";
import { judgeGate } from "#core/judge/gate.ts";
import { judgeVerdictText, remember, warnOnce } from "#core/judge/report.ts";
import { describeHints, type ToolFacts } from "#core/mcp.ts";
import { MODES } from "#core/mode.ts";
import { shortenHome } from "#core/tools.ts";
import { folderChoices } from "#core/workspace.ts";
import { NAME } from "#identity";
import { announce, type Decided } from "#pi/api.ts";
import { currentIntent } from "#pi/intent.ts";
import { clearStatus, notifyJudgePolicyWarning, renderStatus } from "#pi/mode.ts";
import { type FileChange, type PendingWrites, previewEdit, previewWrite } from "#pi/preview.ts";
import { restoreSession } from "#pi/session-entries.ts";
import {
	loadSessionConfig,
	openAlwaysYes,
	openFolder,
	noteJudgeFailure,
	rememberAlwaysYes,
	resetJudgeHealth,
	type SessionState,
} from "#pi/session.ts";
import { AskDialog } from "#ui/dialog.ts";
import { appendJudgeEntry } from "#ui/judge-entry.ts";
import { askThroughQuestions, type AskExtras } from "#ui/questions.ts";
import { askViaSelector } from "#ui/selector.ts";

const JUDGE_STATUS = `${NAME}:judge`;
const TYPING_STATUS = "waiting for you to finish typing";

export function registerEvents(scope: FeatureScope, state: SessionState): void {
	scope.on("session_start", (_event, ctx) => {
		loadSessionConfig(scope, state, ctx);
		openAlwaysYes(state, ctx);
		restoreSession(state, ctx);
		notifyJudgePolicyWarning(state, ctx);
		renderStatus(ctx, state);
		state.typing.start(ctx);
	});

	scope.on("session_tree", (_event, ctx) => {
		restoreSession(state, ctx);
		renderStatus(ctx, state);
	});

	scope.on("session_shutdown", (_event, ctx) => {
		clearStatus(ctx);
		state.typing.stop();
	});

	scope.on("tool_call", async (event, ctx) => {
		const call = describeCall(event.toolName, event.input, ctx.cwd, state.config, {
			custom: state.customTools,
			facts: toolFacts(scope),
			nested: event.parentToolCallId !== undefined,
		});
		const outcome = await gate(scope, state, ctx, call, event);

		announce(scope, {
			toolCallId: event.toolCallId,
			toolName: call.toolName,
			summary: call.target.summary,
			...outcome,
		});
		if (outcome.action === "block") return { block: true, reason: outcome.reason };

		if (outcome.note) {
			if (state.config.notes === "message") sendNote(scope, outcome.note, call.toolName);
			else state.pendingNotes.set(event.toolCallId, outcome.note);
		}
		return undefined;
	});

	scope.on("tool_result", (event) => {
		for (const [path, write] of state.pendingWrites) {
			if (write.toolCallId === event.toolCallId) state.pendingWrites.delete(path);
		}

		const note = state.pendingNotes.get(event.toolCallId);
		if (!note) return undefined;

		state.pendingNotes.delete(event.toolCallId);
		return { content: [...event.content, { type: "text", text: noteBlock(note) }] };
	});
}

type Outcome = Pick<Decided, "action" | "by" | "reason" | "note">;

/** What pi reports about a tool beside its name: the server it belongs to, and its own hints. */
function toolFacts(pi: ExtensionAPI): ToolFacts {
	const tools = pi.getAllTools();
	return (toolName) => tools.find((tool) => tool.name === toolName);
}

async function gate(
	pi: ExtensionAPI,
	state: SessionState,
	ctx: ExtensionContext,
	call: Call,
	event: ToolCallEvent,
): Promise<Outcome> {
	const layers = gateLayers(state);
	if (MODES[state.mode].judge) {
		layers.push({ name: "judge", decide: (next) => runJudge(state, pi, ctx, next) });
	}
	const decision = await decide(call, layers);

	if (decision.action === "allow") return { action: "allow", by: decision.by };
	if (decision.action === "block")
		return { action: "block", by: decision.by, reason: decision.reason };

	if (!ctx.hasUI) {
		if (noUIMode(state.config, call.toolName) === "allow") return { action: "allow", by: "no UI" };
		return { action: "block", by: "no UI", reason: `${NAME}: no UI to approve "${call.toolName}"` };
	}

	const change = await previewChange(ctx, event, state.pendingWrites);
	if (change && "error" in change)
		return { action: "block", by: "edit check", reason: change.error };

	await state.typing.waitUntilQuiet(ctx.signal, (waiting) => {
		ctx.ui.setStatus(NAME, waiting ? TYPING_STATUS : undefined);
	});

	state.typing.pause();
	const reason = "reason" in decision ? decision.reason : undefined;
	const leaving = "by" in decision && decision.by === "workspace";
	const answer = await ask(pi, ctx, call, {
		diff: change?.diff,
		reason,
		offer: leaving ? offerFor(call) : undefined,
	}).finally(() => state.typing.resume());

	if (answer.decision === "deny") {
		return { action: "block", by: "you", reason: denyReason(answer.note), note: answer.note };
	}

	if (answer.remember) {
		const scope = answer.scope ?? "session";
		rememberAlwaysYes(pi, state, ctx, scope, call.toolName, answer.remember);
		ctx.ui.notify(
			`${NAME}: always yes for ${call.toolName}: ${answer.remember} (${SCOPE_LABEL[scope]})`,
			"info",
		);
	}

	if (answer.open) {
		const { path, access, scope } = answer.open;
		openFolder(pi, state, ctx, scope, path, access);
		renderStatus(ctx, state);
		const what =
			access === "read"
				? `reads open in ${shortenHome(path)}`
				: `${shortenHome(path)} joins the workspace`;
		ctx.ui.notify(`${NAME}: ${what}, ${SCOPE_LABEL[scope]}`, "info");
	}

	if (change)
		state.pendingWrites.set(change.path, { toolCallId: event.toolCallId, after: change.after });
	return { action: "allow", by: "you", note: answer.note };
}

function previewChange(
	ctx: ExtensionContext,
	event: ToolCallEvent,
	pending: PendingWrites,
): Promise<FileChange | undefined> {
	if (isToolCallEventType("edit", event)) return previewEdit(ctx, event.input, pending);
	if (isToolCallEventType("write", event)) return previewWrite(ctx, event.input, pending);
	return Promise.resolve(undefined);
}

async function runJudge(
	state: SessionState,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	call: Call,
): Promise<Verdict | undefined> {
	if (Date.now() < state.judgeHealth.retryAt) return undefined;

	const outcome = await judgeGate({
		config: state.config,
		ctx,
		toolName: call.toolName,
		target: call.target,
		rawInput: call.input,
		source: judgeSource(call),
		toolDescription: call.description,
		intent: currentIntent(ctx),
		cache: state.judgeCache,
		onStatus: (status) => ctx.ui.setStatus(JUDGE_STATUS, status),
	});
	if (!outcome) return undefined;

	const record = outcome.record;
	remember(record, state.judgeLog);
	appendJudgeEntry(pi, record);

	if (record.error) {
		warnOnce(ctx, state.judgeWarned, record);
		noteJudgeFailure(state, ctx);
	} else {
		resetJudgeHealth(state);
	}

	if (outcome.action === "deny") {
		return { action: "block", reason: `${NAME}: ${outcome.reason}` };
	}

	if (outcome.action === "allow") {
		if (state.config.judge.rememberApprovals) {
			const level = call.target.levels.at(-1);
			if (level !== undefined) rememberAlwaysYes(pi, state, ctx, "session", call.toolName, level);
		}
		return { action: "allow" };
	}

	if (state.config.judge.dryRun && !record.error) {
		ctx.ui.notify(`${NAME}: judge (dry run) ${judgeVerdictText(record)}`, "info");
	}

	return undefined;
}

// What the tool name does not say: the server behind an MCP tool and what it declares, and a call
// that a script issued rather than the model. The judge reads both as data.
function judgeSource(call: Call): string | undefined {
	const parts: string[] = [];
	if (call.mcp) {
		parts.push(
			`MCP server "${call.mcp.server}", which declares the tool ${describeHints(call.hints)}`,
		);
	}
	if (call.nested) parts.push("issued by a codemode script, not by the model");
	return parts.length === 0 ? undefined : parts.join("; ");
}

// No offer when folderChoices finds nothing to open, like a path in the home itself.
function offerFor(call: Call): FolderOffer | undefined {
	if (call.reach.kind !== "outside") return undefined;
	const choices = folderChoices(call.reach.paths);
	return choices && { ...choices, access: accessOf(call) };
}

async function ask(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	call: Call,
	extras: AskExtras,
): Promise<DialogAnswer> {
	const { toolName, target } = call;
	// One dialog for both: the questions feature draws this when it is installed.
	if (ctx.mode === "tui" && canAsk(pi.events)) {
		const answer = await askThroughQuestions(pi.events, call, extras);
		if (answer !== undefined) return answer;
	}
	if (ctx.mode === "tui") {
		try {
			const answer = await ctx.ui.custom<DialogAnswer>(
				(tui, theme, keybindings, done) =>
					new AskDialog({
						theme,
						toolName,
						target,
						mcp: call.mcp,
						hints: call.hints,
						nested: call.nested,
						...extras,
						keybindings,
						requestRender: () => tui.requestRender(),
						complete: done,
					}),
			);
			if (answer) return answer;
		} catch {
			// The plain selector, not an open gate.
		}
	}

	return askViaSelector(ctx, toolName, target, extras.offer);
}

function sendNote(pi: ExtensionAPI, note: string, toolName: string): void {
	void pi.sendMessage(
		{
			customType: NAME,
			content: noteBlock(note),
			display: true,
			details: { toolName },
		},
		{ deliverAs: "steer" },
	);
}

function noteBlock(note: string): string {
	return `[${NAME}] the user approved this call and added:\n${note}`;
}

function denyReason(note?: string): string {
	return note ? `${NAME}: denied by the user.\n${note}` : `${NAME}: denied by the user.`;
}

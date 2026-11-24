import { canAsk, type FeatureScope, logFrom, MODE, TYPING_STATUS, tildify } from "@adeildo/pi-kit";
import type { ToolCall } from "@earendil-works/pi-ai";
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
	type Decision,
	decide,
	describeCall,
	describeSteps,
	gateLayers,
	type Layer,
	type Verdict,
} from "#core/decide.ts";
import { judgeGate } from "#core/judge/gate.ts";
import { remember, warnOnce } from "#core/judge/report.ts";
import { describeHints, type ToolFacts } from "#core/mcp.ts";
import { MODES } from "#core/mode.ts";
import { asking, JUDGING, judgeDetail, settle } from "#core/ruling.ts";
import { folderChoices } from "#core/workspace.ts";
import { NAME } from "#identity";
import { announce, type Decided } from "#pi/api.ts";
import { intentFor } from "#pi/intent.ts";
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
import { askThroughQuestions, type AskExtras, stepContext } from "#ui/questions.ts";
import { keepRuling, restoreRulings, showRuling } from "#ui/ruling-line.ts";
import { askViaSelector } from "#ui/selector.ts";
import { isRecord } from "#util/primitives.ts";

const JUDGE_STATUS = `${NAME}:judge`;

export function registerEvents(scope: FeatureScope, state: SessionState): void {
	scope.on("session_start", (_event, ctx) => {
		state.ctx = ctx;
		loadSessionConfig(scope, state, ctx);
		openAlwaysYes(state, ctx);
		restoreSession(state, ctx);
		MODE.changed(scope, state.mode);
		restoreRulings(state, ctx);
		notifyJudgePolicyWarning(state, ctx);
		renderStatus(ctx, state);
		state.typing.start(ctx);
	});

	scope.on("session_tree", (_event, ctx) => {
		state.ctx = ctx;
		restoreSession(state, ctx);
		MODE.changed(scope, state.mode);
		restoreRulings(state, ctx);
		renderStatus(ctx, state);
	});

	scope.on("session_shutdown", (_event, ctx) => {
		clearStatus(ctx);
		state.typing.stop();
		state.redraws.clear();
	});

	// Pi gates the calls of an answer one at a time, so each would wait for the judge of the one
	// before. Starting every judge when the answer ends runs them side by side.
	scope.on("message_end", (event, ctx) => {
		if (!MODES[state.mode].judge) return;
		const calls = toolCallsOf(event.message);
		if (calls.length < 2) return;
		for (const { id, name, arguments: input } of calls) {
			const extras = { custom: state.customTools, facts: toolFacts(scope) };
			const call = describeCall(name, input, ctx.cwd, state.config, extras);
			// A chain is judged a step at a time, when its turn comes.
			if (describeSteps(call, state.config, extras) !== undefined) continue;
			const verdict = decide(call, gateLayers(state))
				.then((decision) => ("by" in decision ? undefined : runJudge(scope, state, ctx, call, id)))
				.catch(() => undefined);
			state.prejudged.set(id, { summary: call.target.summary, verdict });
		}
	});

	scope.on("tool_call", async (event, ctx) => {
		const extras = {
			custom: state.customTools,
			facts: toolFacts(scope),
			nested: event.parentToolCallId !== undefined,
		};
		const call = describeCall(event.toolName, event.input, ctx.cwd, state.config, extras);
		const steps = describeSteps(call, state.config, extras);
		const outcome =
			(steps && (await gateChain(scope, state, ctx, call, steps, event))) ??
			(await gate(scope, state, ctx, call, event));
		const ruling = settle(outcome, state.rulings.get(event.toolCallId));
		keepRuling(scope, state, event.toolCallId, ruling);
		// The whole ruling is one short line: its `detail` is the judge's signal, stats and model, or
		// why you were asked, so a log line per call stays small.
		if (ruling !== undefined) {
			const by = outcome.answeredBy === undefined ? {} : { by: outcome.answeredBy };
			logFrom(ctx, scope.events, "call.ruled", { toolCallId: event.toolCallId, ruling, ...by });
		}

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

type Outcome = Pick<Decided, "action" | "by" | "reason" | "note" | "answeredBy">;

/** What pi reports about a tool beside its name: the server it belongs to, and its own hints. */
function toolFacts(pi: ExtensionAPI): ToolFacts {
	const tools = pi.getAllTools();
	return (toolName) => tools.find((tool) => tool.name === toolName);
}

async function gate(
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	call: Call,
	event: ToolCallEvent,
): Promise<Outcome> {
	const layers = gateLayers(state);
	if (MODES[state.mode].judge) {
		layers.push({
			name: "judge",
			decide: (next) =>
				takePrejudged(state, event.toolCallId, next) ??
				runJudge(scope, state, ctx, next, event.toolCallId),
		});
	}
	const decision = await decide(call, layers);
	const ruled = outcomeOf(decision);
	if (ruled) return ruled;

	return askYou(state, ctx, call.toolName, () =>
		askInTurn(scope, state, ctx, call, event, decision),
	);
}

/** Each command of the chain is decided on its own, and the call runs only when every one may.
 * Undefined hands the whole line to `gate`. */
async function gateChain(
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	call: Call,
	steps: Call[],
	event: ToolCallEvent,
): Promise<Outcome | undefined> {
	// The whole line first, with an always yes only for exactly this line: one for its first words,
	// like `cd /repo`, would let anything after them through.
	const exact = { ...call, target: { ...call.target, levels: call.target.levels.slice(-1) } };
	const whole = await decide(exact, gateLayers(state));
	// Nothing approves a protected entry but you, and the whole line names it.
	if ("by" in whole && whole.by === "protected") return undefined;
	const ruled = outcomeOf(whole);
	if (ruled) return ruled;

	const layers = gateLayers(state);
	if (MODES[state.mode].judge) layers.push(judgeLayer(scope, state, ctx, event.toolCallId));
	const runs = steps.filter((step) => step.step?.control !== true);
	const decisions = await Promise.all(runs.map((step) => decide(step, layers)));

	const blocked = decisions.findIndex((decision) => decision.action === "block");
	const block = blocked < 0 ? undefined : outcomeOf(decisions[blocked]!);
	if (block) return { ...block, reason: `${block.reason} (${runs[blocked]!.target.summary})` };

	const asks = runs.flatMap((step, index) => {
		const decision = decisions[index]!;
		return decision.action === "ask" ? [{ step, decision }] : [];
	});
	if (asks.length === 0)
		return {
			action: "allow",
			by: chainBy(decisions.flatMap((decision) => ("by" in decision ? [decision.by] : []))),
		};

	return askYou(state, ctx, call.toolName, async () => {
		const answers: Outcome[] = [];
		for (const { step, decision } of asks) {
			// oxlint-disable-next-line no-await-in-loop -- one dialog at a time, and a no ends the chain.
			const answer = await askInTurn(scope, state, ctx, step, event, decision);
			if (answer.action === "block") return answer;
			answers.push(answer);
		}
		return joinAnswers(
			answers,
			asks.map(({ step }) => step.target.summary),
		);
	});
}

// A codemode script's calls arrive together, and pi shows one dialog at a time.
function askYou(
	state: SessionState,
	ctx: ExtensionContext,
	toolName: string,
	run: () => Promise<Outcome>,
): Promise<Outcome> {
	if (!ctx.hasUI) {
		if (noUIMode(state.config, toolName) === "allow")
			return Promise.resolve({ action: "allow", by: "no UI" });
		return Promise.resolve({
			action: "block",
			by: "no UI",
			reason: `${NAME}: no UI to approve "${toolName}"`,
		});
	}

	return state.asking(run, ctx.signal).catch((error: unknown) => {
		if (!ctx.signal?.aborted) throw error;
		return { action: "block", by: "you", reason: `${NAME}: stopped before you were asked` };
	});
}

function judgeLayer(
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	toolCallId: string,
): Layer {
	return { name: "judge", decide: (next) => runJudge(scope, state, ctx, next, toolCallId) };
}

// The step that says the most about why the line ran: a judge's yes or an always yes over a read.
function chainBy(by: string[]): string {
	return (
		by.find((name) => name === "judge") ??
		by.find((name) => name === "always yes") ??
		by[0] ??
		"read-only bash"
	);
}

function joinAnswers(answers: Outcome[], steps: string[]): Outcome {
	const yours = answers.filter((answer) => answer.by === "you");
	if (yours.length === 0)
		return { action: "allow", by: chainBy(answers.map((answer) => answer.by)) };
	const notes = answers.flatMap((answer, index) =>
		answer.note === undefined ? [] : [{ step: steps[index], note: answer.note }],
	);
	const note =
		notes.length === 0
			? undefined
			: notes.length === 1
				? notes[0]!.note
				: notes.map(({ step, note: text }) => `on \`${step}\`: ${text}`).join("\n");
	return { action: "allow", by: "you", note, answeredBy: yours.at(-1)?.answeredBy };
}

async function askInTurn(
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	call: Call,
	event: ToolCallEvent,
	decision: Decision,
): Promise<Outcome> {
	// An always yes given while this call waited may cover it now.
	const covered = outcomeOf(await decide(call, gateLayers(state)));
	if (covered) return covered;

	const change = await previewChange(ctx, event, state.pendingWrites);
	if (change && "error" in change)
		return { action: "block", by: "edit check", reason: change.error };

	await state.typing.waitUntilQuiet(ctx.signal, (waiting) => {
		ctx.ui.setStatus(NAME, waiting ? TYPING_STATUS : undefined);
	});

	state.typing.pause();
	const reason = "reason" in decision ? decision.reason : undefined;
	const judging = state.rulings.get(event.toolCallId);
	showRuling(scope, state, event.toolCallId, asking(judging?.why ?? reason, judging?.detail));
	const leaving = "by" in decision && decision.by === "workspace";
	const answer = await ask(scope, ctx, call, {
		diff: change?.diff,
		reason,
		offer: leaving ? offerFor(call) : undefined,
	}).finally(() => state.typing.resume());

	if (answer.decision === "deny") {
		return {
			action: "block",
			by: "you",
			reason: denyReason(answer.note, call),
			note: answer.note,
			answeredBy: answer.by,
		};
	}

	if (answer.remember) {
		// A phone's yes lasts until the session ends: a rule that outlives it needs the terminal.
		const where = answer.by?.kind === "client" ? "session" : (answer.scope ?? "session");
		rememberAlwaysYes(scope, state, ctx, where, call.toolName, answer.remember);
		ctx.ui.notify(
			`${NAME}: always yes for ${call.toolName}: ${answer.remember} (${SCOPE_LABEL[where]})`,
			"info",
		);
	}

	if (answer.open) {
		const { path, access } = answer.open;
		const where = answer.by?.kind === "client" ? "session" : answer.open.scope;
		openFolder(scope, state, ctx, where, path, access);
		renderStatus(ctx, state);
		const what =
			access === "read" ? `reads open in ${tildify(path)}` : `${tildify(path)} joins the workspace`;
		ctx.ui.notify(`${NAME}: ${what}, ${SCOPE_LABEL[where]}`, "info");
	}

	if (change)
		state.pendingWrites.set(change.path, { toolCallId: event.toolCallId, after: change.after });
	return { action: "allow", by: "you", note: answer.note, answeredBy: answer.by };
}

function outcomeOf(decision: Decision): Outcome | undefined {
	if (decision.action === "allow") return { action: "allow", by: decision.by };
	if (decision.action === "block")
		return { action: "block", by: decision.by, reason: decision.reason };
	return undefined;
}

/** The verdict started when the answer ended, unless the call changed since. */
function takePrejudged(
	state: SessionState,
	toolCallId: string,
	call: Call,
): Promise<Verdict | undefined> | undefined {
	const started = state.prejudged.get(toolCallId);
	state.prejudged.delete(toolCallId);
	return started?.summary === call.target.summary ? started.verdict : undefined;
}

function toolCallsOf(message: unknown): ToolCall[] {
	if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content))
		return [];
	return message.content.filter(
		(part): part is ToolCall => isRecord(part) && part.type === "toolCall",
	);
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
	scope: FeatureScope,
	state: SessionState,
	ctx: ExtensionContext,
	call: Call,
	toolCallId: string,
): Promise<Verdict | undefined> {
	if (Date.now() < state.judgeHealth.retryAt) return undefined;

	showRuling(scope, state, toolCallId, JUDGING);
	const outcome = await judgeGate({
		config: state.config,
		ctx,
		toolName: call.toolName,
		target: call.target,
		rawInput: call.input,
		source: judgeSource(call),
		toolDescription: call.description,
		intent: intentFor(ctx),
		cache: state.judgeCache,
		onStatus: (status) => ctx.ui.setStatus(JUDGE_STATUS, status),
	});
	if (!outcome) {
		showRuling(scope, state, toolCallId);
		return undefined;
	}

	const record = outcome.record;
	remember(record, state.judgeLog);
	const dryRun = record.dryRun ? " (dry run)" : "";
	showRuling(scope, state, toolCallId, {
		...JUDGING,
		why: `${outcome.reason}${dryRun}`,
		detail: record.answers.verdict ? judgeDetail(record) : undefined,
	});

	if (record.error) {
		warnOnce(ctx, state.judgeWarned, record);
		noteJudgeFailure(state, ctx);
	} else {
		resetJudgeHealth(state);
	}

	if (outcome.action === "deny") {
		return { action: "block", reason: `${NAME}: the judge denied this call, ${outcome.reason}` };
	}

	if (outcome.action === "allow") {
		if (state.config.judge.rememberApprovals) {
			const level = call.target.levels.at(-1);
			if (level !== undefined)
				rememberAlwaysYes(scope, state, ctx, "session", call.toolName, level);
		}
		return { action: "allow" };
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
	if (call.step) parts.push(...stepContext(call));
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
	// Whoever provides questions draws the dialog: the questions feature in a terminal, or the
	// remote bridge in any mode. With no provider, the host's own selector asks.
	if (canAsk(pi.events)) {
		const answer = await askThroughQuestions(pi.events, call, extras, ctx);
		if (answer !== undefined) return answer;
	}

	const summary = [target.summary, ...stepContext(call)].join("\n");
	return askViaSelector(ctx, toolName, { ...target, summary }, extras.offer);
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

function denyReason(note: string | undefined, call: Call): string {
	const what = call.step ? ` this step of the command: ${call.target.summary}` : "";
	const reason = `${NAME}: denied by the user${what}.`;
	return note ? `${reason}\n${note}` : reason;
}

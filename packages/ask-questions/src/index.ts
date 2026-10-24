import {
	ASK,
	ANSWER,
	type AnswerEvent,
	AVAILABLE,
	askQuestions,
	bySession,
	type AskQuestion,
	type AskResult,
	CANCEL,
	canAsk,
	createApp,
	decodeAskRequest,
	defineFeature,
	type FeatureScope,
	isObject,
	oneAtATime,
	TYPING_STATUS,
	TypingMonitor,
} from "@adeildo/pi-kit";
import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";

import { answerText } from "./answers.ts";
import { LiveAsk, opensEarly, streamedQuestions } from "./early.ts";
import { DESCRIPTION, PROMPT_GUIDELINES, PROMPT_SNIPPET } from "./guidance.ts";
import { askOverRpc, type DialogUI } from "./rpc.ts";
import { PARAMETERS, TOOL_NAME } from "./schema.ts";
import {
	bell,
	guidance,
	QUESTION_SETTINGS,
	SECTIONS,
	typingMaxWait,
	typingPause,
} from "./settings.ts";
import { QuestionDialog } from "./ui/dialog.ts";
import { askRenderers } from "./ui/transcript.ts";
import { normalizeParams, problemWith } from "./validate.ts";

export type { AskAnswer, AskQuestion, AskResult } from "@adeildo/pi-kit";
export { answerText } from "./answers.ts";
export { TOOL_NAME } from "./schema.ts";

type Result = AgentToolResult<AskResult>;

const TYPING_KEY = "pi-ask-questions:typing";

type Show = (
	ctx: ExtensionContext,
	asked: readonly AskQuestion[],
	signal: AbortSignal | undefined,
	live?: LiveAsk,
) => Promise<AskResult>;

export const questions = defineFeature({
	id: "questions",
	tab: "Questions",
	description:
		"The model asks with options, a preview of each and your own answer, instead of guessing",
	sections: SECTIONS,
	settings: QUESTION_SETTINGS,
	setup(scope) {
		let session: ExtensionContext | undefined;
		let typing = new TypingMonitor();
		const turns = oneAtATime();
		/** The dialogs opened while the model writes their call, by tool call id. */
		const live = new Map<string, LiveAsk>();
		/** Every request this provider draws or holds in its queue, so a cancel reaches it. */
		const pending = new Map<string, AbortController>();
		/** The tool's own requests, which wait for your typing and ring the bell. */
		const fromTool = new Set<string>();

		// Keys typed into a dialog are not typing in the editor.
		const shown = (
			ctx: ExtensionContext,
			asked: readonly AskQuestion[],
			signal: AbortSignal | undefined,
			early?: LiveAsk,
		) => {
			signal?.throwIfAborted();
			typing.pause();
			return draw(ctx, asked, signal, early).finally(() => typing.resume());
		};
		// Another package that asks waits for your typing itself, with its own settings.
		const showForOthers: Show = (ctx, asked, signal) =>
			turns(() => shown(ctx, asked, signal), signal);
		const showForModel: Show = (ctx, asked, signal, early) =>
			turns(async () => {
				await typing.waitUntilQuiet(signal, (waiting) => {
					ctx.ui.setStatus(TYPING_KEY, waiting ? TYPING_STATUS : undefined);
				});
				signal?.throwIfAborted();
				if (bell.get(scope)) ringBell();
				return shown(ctx, asked, signal, early);
			}, signal);

		// The call's own question takes its dialog out of `live`, so what is left here belongs to a
		// call that will not run, and closes as cancelled.
		const closeLive = (id?: string) => {
			for (const [key, ask] of live) {
				if (id !== undefined && key !== id) continue;
				live.delete(key);
				ask.close();
			}
		};

		const followStream = (id: string, args: unknown, writing: boolean, ctx: ExtensionContext) => {
			const streamed = streamedQuestions(args);
			const open = live.get(id);
			if (open !== undefined) {
				// Questions the tool would refuse, or arguments that never parsed, close the dialog.
				if (!writing && problemWith({ questions: streamed }) !== undefined) closeLive(id);
				else open.update(streamed, writing);
				return;
			}
			if (!writing || !canDraw(ctx) || !opensEarly(streamed)) return;
			const early = new LiveAsk(streamed);
			live.set(id, early);
			early.answer = showForModel(ctx, streamed, early.stop.signal, early).catch((): AskResult => ({
				answers: [],
				cancelled: true,
			}));
		};

		scope.on("message_update", (event, ctx) => {
			const update = event.assistantMessageEvent;
			if (
				update.type !== "toolcall_start" &&
				update.type !== "toolcall_delta" &&
				update.type !== "toolcall_end"
			)
				return;
			const call =
				update.type === "toolcall_end"
					? update.toolCall
					: update.partial.content[update.contentIndex];
			if (call?.type !== "toolCall" || call.name !== TOOL_NAME) return;
			// An error while following the stream closes this dialog and does not reach pi's turn.
			try {
				followStream(call.id, call.arguments, update.type !== "toolcall_end", ctx);
			} catch {
				closeLive(call.id);
			}
		});
		scope.on("tool_execution_end", (event) => closeLive(event.toolCallId));
		// Every turn ends with this event, also one the model never finished: an abort, an error, or a
		// reply cut at the token limit. By then the tool has run every call it was going to run.
		scope.on("turn_end", () => closeLive());

		scope.onSessionStart((ctx) => {
			session = ctx;
			closeLive();
			typing.stop();
			typing = new TypingMonitor(typingPause.get(scope), typingMaxWait.get(scope));
			typing.start(ctx);
		});
		scope.onShutdown(() => {
			session = undefined;
			closeLive();
			typing.stop();
		});

		// Every question asks through here, the tool's own included, so the permission dialog and the
		// agent questions share one dialog, one set of keys and one note model. Whoever else listens,
		// such as a phone, can answer first.
		scope.events.on(AVAILABLE, (data: unknown) => {
			if (canDraw(session) && isObject(data)) data.available = true;
		});
		scope.events.on(ASK, (data: unknown) => {
			const id = isObject(data) && typeof data.id === "string" ? data.id : undefined;
			const ctx = session;
			if (id === undefined || !canDraw(ctx)) return;
			const stop = new AbortController();
			pending.set(id, stop);
			const early = live.get(id);
			live.delete(id);
			const answering =
				early === undefined
					? askRequest(ctx, data, fromTool.has(id) ? showForModel : showForOthers, stop.signal)
					: adopt(early, data, stop.signal);
			// The asker waits on the answer, so it goes out even when the dialog fails. A request
			// someone else closed is no longer pending, and its asker stopped listening.
			void answering.then((result) => {
				if (pending.get(id) !== stop) return;
				pending.delete(id);
				const by = bySession("terminal", scope, ctx.sessionManager);
				const answer: AnswerEvent = { id, by, result };
				scope.events.emit(ANSWER, answer);
			});
		});
		scope.events.on(CANCEL, (data: unknown) => {
			if (!isObject(data) || typeof data.id !== "string") return;
			pending.get(data.id)?.abort();
			pending.delete(data.id);
		});

		scope.registerTool<typeof PARAMETERS, AskResult>({
			name: TOOL_NAME,
			label: "Ask Questions",
			description: DESCRIPTION,
			promptSnippet: PROMPT_SNIPPET,
			promptGuidelines: [...PROMPT_GUIDELINES],
			parameters: PARAMETERS,
			// Codemode scripts cannot call a model-only tool. readOnlyHint lets the permission gate pass it.
			exposure: "model-only",
			annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
			executionMode: "sequential",
			...askRenderers((id) => live.has(id)),
			execute: async (id, params, signal, _onUpdate, ctx) => {
				const asked = normalizeParams(params);
				if (!ctx.hasUI) return failed("There is no UI to ask in");
				const problem = problemWith(asked);
				if (problem !== undefined) {
					closeLive(id);
					throw new Error(problem);
				}
				// Without a provider, as in RPC mode with nothing listening, the tool draws over the
				// host's own dialogs.
				if (!canAsk(scope.events))
					return reply(await showForModel(ctx, asked.questions, signal), asked.questions);
				fromTool.add(id);
				try {
					const options = { id, signal, ctx, source: "ask-questions" };
					return reply(await askQuestions(scope.events, asked.questions, options), asked.questions);
				} finally {
					fromTool.delete(id);
				}
			},
		});

		scope.on("before_agent_start", (event, ctx) => {
			showOnlyWithUI(scope, ctx);
			const extra = guidance.get(scope).trim();
			if (extra === "") return;
			const guidelines = event.systemPromptOptions.toolGuidelines;
			guidelines[TOOL_NAME] = [...(guidelines[TOOL_NAME] ?? []), extra];
		});
	},
});

async function askRequest(
	ctx: ExtensionContext,
	raw: unknown,
	show: Show,
	signal: AbortSignal,
): Promise<AskResult> {
	const problem = decodeAskRequest(raw);
	if (problem !== undefined)
		return { answers: [], cancelled: true, error: `the request did not decode: ${problem}` };
	try {
		return await show(ctx, (raw as { questions: AskQuestion[] }).questions, signal);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { answers: [], cancelled: true, error: `the questions could not be drawn: ${reason}` };
	}
}

function canDraw(ctx: ExtensionContext | undefined): ctx is ExtensionContext {
	return ctx !== undefined && ctx.hasUI && ctx.mode === "tui";
}

/**
 * The answer from the dialog that opened while the model wrote the call. It takes the finished
 * questions, which the tool checked, and closes when someone else answers first.
 */
async function adopt(early: LiveAsk, raw: unknown, signal: AbortSignal): Promise<AskResult> {
	const problem = decodeAskRequest(raw);
	if (problem !== undefined) {
		early.close();
		return { answers: [], cancelled: true, error: `the request did not decode: ${problem}` };
	}
	early.update((raw as { questions: AskQuestion[] }).questions, false);
	const close = () => early.close();
	signal.addEventListener("abort", close, { once: true });
	try {
		return await early.answer;
	} finally {
		signal.removeEventListener("abort", close);
	}
}

const NO_RENDER =
	"This host cannot render the questions. The user never saw them, so this is not a decline";

async function draw(
	ctx: ExtensionContext,
	asked: readonly AskQuestion[],
	signal: AbortSignal | undefined,
	early?: LiveAsk,
): Promise<AskResult> {
	if (ctx.mode === "tui") {
		const result = await ctx.ui.custom<AskResult>((tui, theme, keybindings, done) => {
			// An early dialog opens on what the stream has by now, which is more than when it queued.
			const dialog = new QuestionDialog({
				tui,
				theme,
				markdownTheme: getMarkdownTheme(),
				keybindings,
				questions: early?.questions ?? asked,
				writing: early?.writing ?? false,
				complete: done,
			});
			early?.attach(dialog);
			// Someone else answered, or the asker gave up: the dialog closes as cancelled.
			if (signal?.aborted) dialog.close();
			else signal?.addEventListener("abort", () => dialog.close(), { once: true });
			return dialog;
		});
		if (result !== undefined) return result;
	}
	// A host that cannot draw a component may still have the select and input dialogs.
	const overDialogs = await askOverDialogs(ctx, asked);
	if (overDialogs !== undefined) return overDialogs;
	return { answers: [], cancelled: true, error: NO_RENDER };
}

async function askOverDialogs(
	ctx: ExtensionContext,
	asked: readonly AskQuestion[],
): Promise<AskResult | undefined> {
	const ui = ctx.ui as Partial<DialogUI>;
	if (typeof ui.select !== "function" || typeof ui.input !== "function") return undefined;
	return askOverRpc(ui as DialogUI, asked);
}

function reply(result: AskResult, asked: readonly AskQuestion[]): Result {
	return { content: [{ type: "text", text: answerText(result, asked) }], details: result };
}

function failed(error: string): Result {
	return reply({ answers: [], cancelled: true, error }, []);
}

// With no one to answer, the model should not see the tool at all.
function showOnlyWithUI(scope: FeatureScope, ctx: ExtensionContext): void {
	const active = scope.getActiveTools();
	const has = active.includes(TOOL_NAME);
	if (!ctx.hasUI && has) scope.setActiveTools(active.filter((name) => name !== TOOL_NAME));
	else if (ctx.hasUI && !has) scope.setActiveTools([...active, TOOL_NAME]);
}

// A piped RPC transport would carry the byte to a host that draws its own UI.
function ringBell(): void {
	if (process.stdout.isTTY) process.stdout.write("\x07");
}

export default function piQuestions(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-ask-questions" }).use(questions).build();
}

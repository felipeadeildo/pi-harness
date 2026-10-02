import {
	ASK,
	ANSWER,
	AVAILABLE,
	type AskQuestion,
	type AskResult,
	createApp,
	decodeAskRequest,
	defineFeature,
	type FeatureScope,
	isObject,
} from "@adeildo/pi-kit";
import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";

import { answerText } from "./answers.ts";
import { DESCRIPTION, PROMPT_GUIDELINES, PROMPT_SNIPPET } from "./guidance.ts";
import { askOverRpc, type DialogUI } from "./rpc.ts";
import { PARAMETERS, type QuestionParams, TOOL_NAME } from "./schema.ts";
import { bell, guidance, QUESTION_SETTINGS, SECTIONS } from "./settings.ts";
import { QuestionDialog } from "./ui/dialog.ts";
import { renderCall, renderResult } from "./ui/transcript.ts";
import { normalizeParams, problemWith } from "./validate.ts";

export type { AskAnswer, AskQuestion, AskResult } from "@adeildo/pi-kit";
export { answerText } from "./answers.ts";
export { TOOL_NAME } from "./schema.ts";

type Result = AgentToolResult<AskResult>;

export const questions = defineFeature({
	id: "questions",
	tab: "Questions",
	description:
		"The model asks with options, a preview of each and your own answer, instead of guessing",
	sections: SECTIONS,
	settings: QUESTION_SETTINGS,
	setup(scope) {
		let session: ExtensionContext | undefined;

		scope.onSessionStart((ctx) => {
			session = ctx;
		});
		scope.onShutdown(() => {
			session = undefined;
		});

		// Other packages ask through here, so the permission dialog and the agent questions share one
		// dialog, one set of keys and one note model.
		scope.events.on(AVAILABLE, (data: unknown) => {
			if (canDraw(session) && isObject(data)) data.available = true;
		});
		scope.events.on(ASK, (data: unknown) => {
			const id = isObject(data) && typeof data.id === "string" ? data.id : undefined;
			const ctx = session;
			if (id === undefined || !canDraw(ctx)) return;
			// The asker waits on the answer, so it goes out even when the dialog fails.
			void askRequest(ctx, data).then((result) => scope.events.emit(ANSWER, { id, result }));
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
			renderCall: (args, theme) => renderCall(args, theme),
			renderResult: (result, options, theme) => renderResult(result, options, theme),
			execute: (_id, params, _signal, _onUpdate, ctx) =>
				askTool(scope, ctx, normalizeParams(params)),
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

async function askRequest(ctx: ExtensionContext, raw: unknown): Promise<AskResult> {
	const problem = decodeAskRequest(raw);
	if (problem !== undefined)
		return { answers: [], cancelled: true, error: `the request did not decode: ${problem}` };
	try {
		return await draw(ctx, (raw as { questions: AskQuestion[] }).questions);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { answers: [], cancelled: true, error: `the questions could not be drawn: ${reason}` };
	}
}

function canDraw(ctx: ExtensionContext | undefined): ctx is ExtensionContext {
	return ctx !== undefined && ctx.hasUI && ctx.mode === "tui";
}

async function askTool(
	scope: FeatureScope,
	ctx: ExtensionContext,
	params: QuestionParams,
): Promise<Result> {
	if (!ctx.hasUI) return failed("There is no UI to ask in");
	const problem = problemWith(params);
	if (problem !== undefined) throw new Error(problem);

	if (bell.get(scope)) ringBell();
	return reply(await draw(ctx, params.questions), params.questions);
}

const NO_RENDER =
	"This host cannot render the questions. The user never saw them, so this is not a decline";

async function draw(ctx: ExtensionContext, asked: readonly AskQuestion[]): Promise<AskResult> {
	if (ctx.mode === "tui") {
		const result = await ctx.ui.custom<AskResult>(
			(tui, theme, keybindings, done) =>
				new QuestionDialog({
					tui,
					theme,
					markdownTheme: getMarkdownTheme(),
					keybindings,
					questions: asked,
					complete: done,
				}),
		);
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

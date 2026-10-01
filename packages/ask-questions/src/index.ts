import { createApp, defineFeature, type FeatureScope } from "@adeildo/pi-kit";
import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";

import { answerText, type QuestionsResult } from "./answers.ts";
import { DESCRIPTION, PROMPT_GUIDELINES, PROMPT_SNIPPET } from "./guidance.ts";
import { askOverRpc } from "./rpc.ts";
import { PARAMETERS, type QuestionParams, TOOL_NAME } from "./schema.ts";
import { bell, guidance, QUESTION_SETTINGS, SECTIONS } from "./settings.ts";
import { QuestionDialog } from "./ui/dialog.ts";
import { renderCall, renderResult } from "./ui/transcript.ts";
import { normalizeParams, problemWith } from "./validate.ts";

export type { Answer, OptionNote, QuestionsResult } from "./answers.ts";
export { TOOL_NAME } from "./schema.ts";

type Result = AgentToolResult<QuestionsResult>;

export const questions = defineFeature({
	id: "questions",
	tab: "Questions",
	description:
		"The model asks with options, a preview of each and your own answer, instead of guessing",
	sections: SECTIONS,
	settings: QUESTION_SETTINGS,
	setup(scope) {
		scope.registerTool<typeof PARAMETERS, QuestionsResult>({
			name: TOOL_NAME,
			label: "Ask User Question",
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
			execute: (_id, params, _signal, _onUpdate, ctx) => ask(scope, ctx, normalizeParams(params)),
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

// Without a UI the model would wait for an answer that never comes.
function showOnlyWithUI(scope: FeatureScope, ctx: ExtensionContext): void {
	const active = scope.getActiveTools();
	const has = active.includes(TOOL_NAME);
	if (!ctx.hasUI && has) scope.setActiveTools(active.filter((name) => name !== TOOL_NAME));
	else if (ctx.hasUI && !has) scope.setActiveTools([...active, TOOL_NAME]);
}

async function ask(
	scope: FeatureScope,
	ctx: ExtensionContext,
	params: QuestionParams,
): Promise<Result> {
	if (!ctx.hasUI) return failed("There is no UI to ask in");
	const problem = problemWith(params);
	if (problem !== undefined) throw new Error(problem);

	if (bell.get(scope)) ringBell();
	if (ctx.mode !== "tui") return reply(await askOverRpc(ctx.ui, params), params);

	const result = await ctx.ui.custom<QuestionsResult>(
		(tui, theme, keybindings, done) =>
			new QuestionDialog({
				tui,
				theme,
				markdownTheme: getMarkdownTheme(),
				keybindings,
				questions: params.questions,
				complete: done,
			}),
	);
	// A host that cannot draw components resolves undefined, but its select and input may work.
	if (result === undefined) return reply(await askOverRpc(ctx.ui, params), params);
	return reply(result, params);
}

function reply(result: QuestionsResult, params: QuestionParams): Result {
	return {
		content: [{ type: "text", text: answerText(result, params.questions) }],
		details: result,
	};
}

function failed(error: string): Result {
	return reply({ answers: [], cancelled: true, error }, { questions: [] });
}

// A piped RPC transport would carry the byte to a host that draws its own UI.
function ringBell(): void {
	if (process.stdout.isTTY) process.stdout.write("\x07");
}

export default function piQuestions(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-ask-questions" }).use(questions).build();
}

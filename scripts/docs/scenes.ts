import { createEventBus, type Theme } from "@earendil-works/pi-coding-agent";

import { SCOPE_LABEL } from "../../packages/ask-permission/src/core/always-yes.ts";
import type { FolderOffer } from "../../packages/ask-permission/src/core/answer.ts";
import { defaultConfig } from "../../packages/ask-permission/src/core/config/schema.ts";
import { type Call, describeCall } from "../../packages/ask-permission/src/core/decide.ts";
import {
	type AskExtras,
	askThroughQuestions,
} from "../../packages/ask-permission/src/ui/questions.ts";
// A scene `pkg/file` draws `packages/pkg/assets/file.png`. A page shows it with an empty
// `<!-- docs:pkg/file -->` `<!-- /docs -->` block, which `bun run docs` fills.
import {
	ANSWER,
	ASK,
	type AskQuestion,
	type AskRequest,
	type AskResult,
	AVAILABLE,
} from "../../packages/kit/src/index.ts";
import { drawCalls, type CallSpec } from "./calls.ts";
import { KEYS, openDialog, press, type, WIDTH } from "./drive.ts";
import { drawLook } from "./look.ts";

export interface Scene {
	name: string;
	caption: string;
	alt: string;
	draw(theme: Theme): string[] | Promise<string[]>;
}

// ── ask_questions ───────────────────────────────────────────────────────────────────────────

const LAYOUT: AskQuestion = {
	header: "Layout",
	question: "Which layout should the accounts section use?",
	options: [
		{
			label: "Tree (Recommended)",
			description: "Provider first, then its accounts. Scales to many providers.",
			preview:
				"```\nAnthropic\n  ● work   active\n  ○ home\n  + add account\nOpenAI\n  ○ personal\n```",
		},
		{
			label: "Flat list",
			description: "One row per account, with the provider as a column.",
			preview:
				"```\n● work      Anthropic   active\n○ home      Anthropic\n○ personal  OpenAI\n```",
		},
	],
};

const SCOPE: AskQuestion = {
	header: "Scope",
	question: "Where should the choice be remembered?",
	options: [
		{ label: "This session", description: "Gone when the session ends." },
		{ label: "This project", description: "Every session in this folder." },
	],
};

const RULES: AskQuestion = {
	header: "Rules",
	question: "Which of these rules should the docs follow?",
	multiSelect: true,
	options: [
		{ label: "Sentence case", description: "Headings start with a capital and nothing else." },
		{ label: "One idea per sentence", description: "Split what makes the reader backtrack." },
		{ label: "Examples from the code", description: "A generated example cannot go stale." },
	],
};

function questionsDialog(theme: Theme): string[] {
	const dialog = openDialog(theme, [LAYOUT, SCOPE]);
	press(dialog, KEYS.tab);
	type(dialog, "my pick");
	press(dialog, KEYS.enter);
	return dialog.render(WIDTH);
}

function questionsMulti(theme: Theme): string[] {
	const dialog = openDialog(theme, [LAYOUT, RULES]);
	press(dialog, KEYS.enter, KEYS.space, KEYS.down, KEYS.down, KEYS.space);
	return dialog.render(WIDTH);
}

function questionsReview(theme: Theme): string[] {
	const dialog = openDialog(theme, [LAYOUT, SCOPE, RULES]);
	press(dialog, KEYS.enter, KEYS.enter, KEYS.space, KEYS.right);
	return dialog.render(WIDTH);
}

// ── permission ──────────────────────────────────────────────────────────────────────────────

function chosen(header: string, option: string): AskResult {
	return { answers: [{ question: "q", header, picked: [option], notes: [] }], cancelled: false };
}

/** Runs the permission ask against a scripted answerer and returns every question it asked. */
async function asked(call: Call, extras: AskExtras, script: AskResult[]): Promise<AskQuestion[]> {
	const bus = createEventBus();
	const questions: AskQuestion[] = [];
	bus.on(AVAILABLE, (data: unknown) => void ((data as { available: boolean }).available = true));
	bus.on(ASK, (data: unknown) => {
		const request = data as AskRequest;
		questions.push(...request.questions);
		const result = script.shift() ?? { answers: [], cancelled: true };
		bus.emit(ANSWER, { id: request.id, result });
	});
	await askThroughQuestions(bus, call, extras);
	return questions;
}

function callOf(toolName: string, input: unknown): Call {
	return describeCall(toolName, input, "/repo", defaultConfig());
}

function required(question: AskQuestion | undefined, what: string): AskQuestion {
	if (question === undefined) throw new Error(`${what} did not ask`);
	return question;
}

async function permissionAsk(theme: Theme): Promise<string[]> {
	const questions = await asked(
		callOf("bash", { command: "npm install" }),
		{ reason: "the judge leaned deny but was only 61% confident" },
		[chosen("permission", "no")],
	);
	const dialog = openDialog(theme, [required(questions[0], "the permission ask")]);
	press(dialog, KEYS.down, KEYS.down, KEYS.tab);
	type(dialog, "use pnpm instead");
	press(dialog, KEYS.enter);
	return dialog.render(WIDTH);
}

async function permissionRemember(theme: Theme): Promise<string[]> {
	const call = callOf("bash", { command: "pnpm test" });
	const narrowest = [...call.target.levels].toReversed()[0] ?? "";
	const questions = await asked(call, {}, [
		chosen("permission", "always yes"),
		chosen("remember", narrowest),
		chosen("where", SCOPE_LABEL.session),
	]);
	const remember = questions.find((question) => question.header === "remember");
	return openDialog(theme, [required(remember, "always yes")]).render(WIDTH);
}

async function permissionFolder(theme: Theme): Promise<string[]> {
	const offer = {
		access: "read",
		folders: ["/home/me/Projects/grace", "/home/me/Projects/grace/apps"],
		suggested: 0,
		repoRoot: "/home/me/Projects/grace",
	} as unknown as FolderOffer;
	const questions = await asked(
		callOf("bash", { command: "cd ~/Projects/grace/apps/web && git status --short | head" }),
		{ reason: "reads outside the workspace", offer },
		[chosen("permission", "no")],
	);
	const dialog = openDialog(theme, [required(questions[0], "the permission ask")]);
	press(dialog, KEYS.down, KEYS.down);
	return dialog.render(WIDTH);
}

// ── tool calls ─────────────────────────────────────────────────────────────────────────────

/** The tools the frames below are drawn for, in the width the other pictures use. */
function toolCalls(specs: readonly CallSpec[]): string[] {
	return drawCalls(specs, WIDTH);
}

function lookCall(): string[] {
	return toolCalls([
		{
			tool: "bash",
			args: { command: "bun run test" },
			output: "583 pass\n0 fail",
			elapsedMs: 6_800,
			ruling: { tone: "success", head: "judge approved", why: "97% sure, risk 0.12" },
		},
		{
			tool: "read",
			args: { path: "src/ui/tool-frame.ts" },
			output: "export function registerToolFrames(scope: FeatureScope): void {\n  // ...",
			elapsedMs: 40,
			ruling: { tone: "success", head: "always yes", why: "read, this project" },
		},
		{
			tool: "bash",
			args: { command: "pnpm test --watch" },
			output: "✓ core  (0.31 seconds)",
			elapsedMs: 3_200,
			running: true,
			ruling: { tone: "warning", head: "asking you", why: "the judge wants a person to decide" },
		},
	]);
}

function harnessPreview(): string[] {
	return toolCalls([
		{
			tool: "bash",
			args: { command: "bun run test" },
			output: "... (3 earlier lines, ctrl+o to expand)\n✓ 583 pass\n✓ 0 fail",
			elapsedMs: 6_800,
			ruling: { tone: "success", head: "judge approved", why: "97% sure, risk 0.12" },
		},
	]);
}

export const SCENES: readonly Scene[] = [
	{
		name: "ask-questions/preview",
		caption: "Two questions as tabs, and the preview of the focused option.",
		alt: "The question dialog: two questions as tabs, the options on the left, and on the right the description and the preview of the focused option.",
		draw: questionsDialog,
	},
	{
		name: "ask-questions/multi",
		caption: "A question that takes several answers.",
		alt: "A question that takes several answers, with two of its three options checked.",
		draw: questionsMulti,
	},
	{
		name: "ask-questions/review",
		caption: "Every answer on one tab, before it goes to the model.",
		alt: "The review tab: every question with its answer, before submitting.",
		draw: questionsReview,
	},
	{
		name: "ask-permission/preview",
		caption: "No, with a note the model reads: use pnpm instead.",
		alt: "The permission dialog for npm install, with the reason it asks, the three answers, and a note on no: use pnpm instead.",
		draw: permissionAsk,
	},
	{
		name: "ask-permission/remember",
		caption: "Always yes asks which calls to remember.",
		alt: "After always yes, the dialog asks which calls to remember: this exact call, or every pnpm call.",
		draw: permissionRemember,
	},
	{
		name: "ask-permission/folder",
		caption: "A read outside the workspace can open that folder for reads.",
		alt: "A read outside the workspace, with an answer that also allows reads in that folder.",
		draw: permissionFolder,
	},
	{
		name: "look/call",
		caption: "One command that ran, one a rule let through, and one still going.",
		alt: "Three commands, each in its own box: a bash command with the reason it was allowed and the time it took, a file read, and a command still running.",
		draw: lookCall,
	},
	{
		name: "harness/preview",
		caption: "A command the model wanted to run, and the reason it was allowed.",
		alt: "A bash command in a box, with the reason it was allowed, what it printed, and the time it took.",
		draw: harnessPreview,
	},
	{
		name: "look/preview",
		caption: "The start card, then a prompt halfway through its answer.",
		alt: "Pi with the look: the start card, then the strip with the stopwatch and the last call, the framed editor with the branch, the model and the context, and below it the cost, the tokens, the cache and the average speeds.",
		draw: drawLook,
	},
];

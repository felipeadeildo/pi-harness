import { createEventBus, type Theme } from "@earendil-works/pi-coding-agent";

import { SCOPE_LABEL } from "../../packages/ask-permission/src/core/always-yes.ts";
import type { FolderOffer } from "../../packages/ask-permission/src/core/answer.ts";
import { defaultConfig } from "../../packages/ask-permission/src/core/config/schema.ts";
import { type Call, describeCall } from "../../packages/ask-permission/src/core/decide.ts";
import {
	type AskExtras,
	askThroughQuestions,
} from "../../packages/ask-permission/src/ui/questions.ts";
// Every picture in the docs. To add one, add an entry to `SCENES` and a marker to a page:
//
//   <!-- docs:name -->
//
//   ```text
//   ```
//
//   <!-- /docs -->
//
// `draw` gets a theme and returns the lines of the dialog. The text blocks use a theme that paints
// nothing, and `image`, when set, is where `bun run docs:images` writes the PNG, without the extension.
import {
	ANSWER,
	ASK,
	type AskQuestion,
	type AskRequest,
	type AskResult,
	AVAILABLE,
} from "../../packages/kit/src/index.ts";
import { KEYS, openDialog, press, type, WIDTH } from "./drive.ts";

export interface Scene {
	name: string;
	image?: string;
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

function first(questions: AskQuestion[], what: string): AskQuestion {
	const [question] = questions;
	if (question === undefined) throw new Error(`${what} did not ask`);
	return question;
}

async function permissionAsk(theme: Theme): Promise<string[]> {
	const questions = await asked(
		callOf("bash", { command: "npm install" }),
		{ reason: "the judge leaned deny but was only 61% confident" },
		[chosen("permission", "no")],
	);
	const dialog = openDialog(theme, [first(questions, "the permission ask")]);
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
	return openDialog(theme, [first(remember ? [remember] : [], "always yes")]).render(WIDTH);
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
	const dialog = openDialog(theme, [first(questions, "the permission ask")]);
	press(dialog, KEYS.down, KEYS.down);
	return dialog.render(WIDTH);
}

export const SCENES: readonly Scene[] = [
	{
		name: "ask-questions/dialog",
		image: "packages/ask-questions/assets/preview",
		draw: questionsDialog,
	},
	{ name: "ask-questions/multi", draw: questionsMulti },
	{ name: "ask-questions/review", draw: questionsReview },
	{
		name: "ask-permission/ask",
		image: "packages/ask-permission/assets/preview",
		draw: permissionAsk,
	},
	{ name: "ask-permission/remember", draw: permissionRemember },
	{ name: "ask-permission/folder", draw: permissionFolder },
];

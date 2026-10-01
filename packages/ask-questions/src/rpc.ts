// RPC hosts draw pi's select and input dialogs but not terminal components, so the questions go one
// dialog at a time, without previews or notes. Ported from rpiv-ask-user-question.
import type { Answer, QuestionsResult } from "./answers.ts";
import { type Question, type QuestionParams, TYPED_LABEL } from "./schema.ts";

export interface DialogUI {
	select(title: string, options: string[]): Promise<string | undefined>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
}

const MAX_PREVIEW_CHARS = 600;

export async function askOverRpc(ui: DialogUI, params: QuestionParams): Promise<QuestionsResult> {
	const answers: Answer[] = [];
	for (const question of params.questions) {
		const ask = question.multiSelect ? askMany : askOne;
		// oxlint-disable-next-line no-await-in-loop -- one dialog at a time, in the order asked
		const answer = await ask(ui, question);
		if (answer === undefined) return { answers, cancelled: true };
		answers.push(answer);
	}
	return { answers, cancelled: false };
}

function titleOf(question: Question): string {
	return question.header ? `[${question.header}] ${question.question}` : question.question;
}

function optionLine(question: Question, index: number): string {
	const option = question.options[index];
	return option === undefined ? "" : `${index + 1}. ${option.label}: ${option.description}`;
}

function previews(question: Question): string {
	const blocks = question.options.flatMap((option, index) =>
		option.preview
			? [`--- ${index + 1}. ${option.label} ---\n${option.preview.slice(0, MAX_PREVIEW_CHARS)}`]
			: [],
	);
	return blocks.length === 0 ? "" : `\n\n${blocks.join("\n\n")}`;
}

function blank(question: Question): Answer {
	return { question: question.question, header: question.header, picked: [], notes: [] };
}

async function askOne(ui: DialogUI, question: Question): Promise<Answer | undefined> {
	const lines = question.options.map((_, index) => optionLine(question, index));
	lines.push(`${question.options.length + 1}. ${TYPED_LABEL}`);

	const chosen = await ui.select(`${titleOf(question)}${previews(question)}`, lines);
	if (chosen === undefined) return undefined;
	// An answer that was not offered counts as a dismissal.
	const index = lines.indexOf(chosen);
	if (index < 0) return undefined;

	const option = question.options[index];
	if (option !== undefined) return { ...blank(question), picked: [option.label] };

	const typed = await ui.input(`${titleOf(question)}\n\nYour answer:`, "");
	if (typed === undefined) return undefined;
	return { ...blank(question), typed };
}

async function askMany(ui: DialogUI, question: Question): Promise<Answer | undefined> {
	const list = question.options.map((_, index) => optionLine(question, index)).join("\n");
	const value = await ui.input(
		`${titleOf(question)}\n\n${list}\n\nThe numbers of every one that applies, like "1,3", or your own answer.`,
		"1,3",
	);
	if (value === undefined) return undefined;

	const text = value.trim();
	if (text === "") return blank(question);

	const picked = pickedLabels(question, text);
	return picked === undefined
		? { ...blank(question), typed: text }
		: { ...blank(question), picked };
}

// Undefined when the text is not a list of option numbers.
function pickedLabels(question: Question, text: string): string[] | undefined {
	const picked: string[] = [];
	for (const token of text.split(/[,\s]+/).filter(Boolean)) {
		if (!/^\d+\.?$/.test(token)) return undefined;
		const label = question.options[Number.parseInt(token, 10) - 1]?.label;
		if (label === undefined) return undefined;
		if (!picked.includes(label)) picked.push(label);
	}
	return picked;
}

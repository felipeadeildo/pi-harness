// The dialog opens while the model writes the call; pi parses arguments as they stream. When the
// tool runs, it waits on the same answer.
import { type AskOption, type AskQuestion, type AskResult, isObject } from "@adeildo/pi-kit";

import type { QuestionDialog } from "./ui/dialog.ts";
import { normalizeText } from "./validate.ts";

export class LiveAsk {
	questions: readonly AskQuestion[];
	writing = true;
	/** Leaves the queue, or the wait for your typing, when the call ends before the dialog opens. */
	readonly stop = new AbortController();
	answer: Promise<AskResult> = Promise.resolve({ answers: [], cancelled: true });
	private dialog: QuestionDialog | undefined;

	constructor(questions: readonly AskQuestion[]) {
		this.questions = questions;
	}

	attach(dialog: QuestionDialog): void {
		this.dialog = dialog;
	}

	/** While the model writes, a step back from a cut token is skipped, so answers never vanish. */
	update(questions: readonly AskQuestion[], writing: boolean): void {
		if (writing && questions.length < this.questions.length) return;
		this.questions = questions;
		this.writing = writing;
		this.dialog?.update(questions, writing);
	}

	close(): void {
		this.stop.abort();
		this.dialog?.close();
	}
}

export function opensEarly(questions: readonly AskQuestion[]): boolean {
	return (questions[0]?.question ?? "").trim() !== "";
}

/** Every question but the last is whole; the last may lack its header, options or end. */
export function streamedQuestions(args: unknown): AskQuestion[] {
	if (!isObject(args) || !Array.isArray(args.questions)) return [];
	return args.questions.filter(isObject).map((raw) => {
		const question: AskQuestion = {
			question: normalizeText(stringOr(raw.question)),
			header: normalizeText(stringOr(raw.header)),
			options: Array.isArray(raw.options) ? raw.options.flatMap(streamedOption) : [],
		};
		if (typeof raw.multiSelect === "boolean") question.multiSelect = raw.multiSelect;
		return question;
	});
}

function streamedOption(raw: unknown): AskOption[] {
	if (!isObject(raw) || typeof raw.label !== "string") return [];
	const option: AskOption = { label: normalizeText(raw.label) };
	if (typeof raw.description === "string") option.description = normalizeText(raw.description);
	if (typeof raw.preview === "string") option.preview = normalizeText(raw.preview);
	return [option];
}

function stringOr(value: unknown): string {
	return typeof value === "string" ? value : "";
}

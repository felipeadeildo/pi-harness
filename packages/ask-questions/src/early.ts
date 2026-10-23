// The dialog opens while the model is still writing the call. Pi parses the arguments as they
// stream, so the first question can be read, and answered once whole, while the next ones arrive.
// When pi runs the tool, it finds the dialog already open and waits on the same answer.
import { type AskOption, type AskQuestion, type AskResult, isObject } from "@adeildo/pi-kit";

import type { QuestionDialog } from "./ui/dialog.ts";
import { normalizeText } from "./validate.ts";

/** One call's dialog, from the first question the model writes until the tool answers. */
export class LiveAsk {
	questions: readonly AskQuestion[];
	writing = true;
	/** Whether the tool took this answer. If it did not, the call never ran and the dialog closes. */
	adopted = false;
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

	/**
	 * A stream cut mid-token can parse to fewer questions than the last delta did. While the model
	 * writes, such a step back is skipped, so what you answered never vanishes. The finished call
	 * is taken whole, since the tool checks it before you can send.
	 */
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

/** Whether the stream has enough to open on: the text of the first question. */
export function opensEarly(questions: readonly AskQuestion[]): boolean {
	return (questions[0]?.question ?? "").trim() !== "";
}

/**
 * The questions as far as the stream got. Every question but the last is whole, since the model
 * started the next one. The last may lack its header, its options or the end of its text.
 */
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

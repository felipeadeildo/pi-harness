// One dialog for every question. The permission dialog used to ask in its own way, with its own
// keys; now whoever needs an answer asks here and the questions feature draws it.
//
// The bus is synchronous, so a request carries an id and the answer arrives on a second channel,
// like the screen's `run` does.
import { isObject } from "../decode.ts";
import { GLYPH } from "../ui/glyphs.ts";
import type { By } from "./by.ts";

/** A provider answers this to say it can draw a question right now. */
export const AVAILABLE = "harness:ask:available";
export const ASK = "harness:ask";
export const ANSWER = "harness:ask:answer";
/**
 * The question closed: someone answered it, or the asker gave up. Only the asker's client emits it,
 * since it decides the race. A provider drawing the question closes its dialog, and one still holding
 * it in a queue drops it without drawing. A provider whose dialog closes on its own, as on Esc,
 * answers with `cancelled: true` and never emits this: without that answer the asker waits forever.
 */
export const CANCEL = "harness:ask.cancel";

export interface AskOption {
	label: string;
	description?: string;
	/** Shown beside the options while this one is focused. */
	preview?: string;
}

export interface AskQuestion {
	header: string;
	question: string;
	options: AskOption[];
	multiSelect?: boolean;
	/** A last row for an answer in the user's own words. On unless it is `false`. */
	typed?: boolean;
}

export interface AskRequest {
	id: string;
	questions: AskQuestion[];
	answer?: AskResult;
}

export interface AskNote {
	option: string;
	note: string;
}

export interface AskAnswer {
	question: string;
	header: string;
	picked: string[];
	typed?: string;
	notes: AskNote[];
}

export interface AskResult {
	answers: AskAnswer[];
	cancelled: boolean;
	error?: string;
}

/** What the asker gets: the answer, and who gave it or who gave up, when that is known. */
export interface AskReply extends AskResult {
	by?: By;
}

export interface AnswerEvent {
	id: string;
	/** Who answered. An answer without it is logged as from nobody known, never as the terminal. */
	by?: By;
	result: AskResult;
}

export interface AskCancel {
	id: string;
	reason: "answered" | "aborted";
	/** Who answered, when the question closed on an answer that said. */
	by?: By;
}

export function isAskResult(value: unknown): value is AskResult {
	if (!isObject(value)) return false;
	return Array.isArray(value.answers) && typeof value.cancelled === "boolean";
}

export function isAnswered(answer: AskAnswer): boolean {
	return answer.picked.length > 0 || (answer.typed ?? "").trim() !== "";
}

/** One line per answer, with its notes under it, as the agent and anything after it read them. */
export function describeAnswers(answers: readonly AskAnswer[]): string[] {
	const lines: string[] = [];
	for (const answer of answers) {
		lines.push(`- ${answer.header}: "${answer.question}" ${GLYPH.right} ${answerSummary(answer)}`);
		for (const { option, note } of answer.notes) {
			const tag = answer.picked.includes(option) ? "" : " (not picked)";
			lines.push(`  note on "${option}"${tag}: ${note}`);
		}
	}
	return lines;
}

export function answerSummary(answer: AskAnswer): string {
	const parts = answer.picked.map((label) => `"${label}"`);
	const typed = answer.typed?.trim();
	if (typed) parts.push(`in their words: "${typed}"`);
	return parts.length === 0 ? "(nothing)" : parts.join(", ");
}

/** Why a request cannot be used, for a provider reading one from another version. */
export function decodeAskRequest(value: unknown): string | undefined {
	if (!isObject(value)) return "not an object";
	if (typeof value.id !== "string") return "no id";
	if (!Array.isArray(value.questions)) return "no questions";
	for (const question of value.questions) {
		if (!isObject(question)) return "a question is not an object";
		if (typeof question.header !== "string" || typeof question.question !== "string")
			return "a question has no header or text";
		if (!Array.isArray(question.options) || question.options.length === 0)
			return `"${question.header}" has no options`;
		if (question.typed !== undefined && typeof question.typed !== "boolean")
			return `"${question.header}" has a typed flag that is not a boolean`;
		for (const option of question.options) {
			if (!isObject(option) || typeof option.label !== "string")
				return `"${question.header}" has an option with no label`;
		}
	}
	return undefined;
}

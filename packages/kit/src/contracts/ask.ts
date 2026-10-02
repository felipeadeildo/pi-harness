// One dialog for every question. The permission dialog used to ask in its own way, with its own
// keys; now whoever needs an answer asks here and the questions feature draws it.
//
// The bus is synchronous, so a request carries an id and the answer arrives on a second channel,
// like the screen's `run` does.
import { isObject } from "../decode.ts";

/** A provider answers this to say it can draw a question right now. */
export const AVAILABLE = "harness:ask:available";
export const ASK = "harness:ask";
export const ANSWER = "harness:ask:answer";

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

export interface AnswerEvent {
	id: string;
	result: AskResult;
}

export function isAskResult(value: unknown): value is AskResult {
	if (!isObject(value)) return false;
	return Array.isArray(value.answers) && typeof value.cancelled === "boolean";
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

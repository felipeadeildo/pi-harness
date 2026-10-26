// The answer to an agent's question, as the same `AskResult` the terminal produces.

import type { AskResult, OpenAsk } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";

export interface Draft {
	picks: Record<number, string[]>;
	/** When they typed instead of picking. */
	typed: Record<number, string>;
}

export const EMPTY: Draft = { picks: {}, typed: {} };

/** A single-answer question replaces what was there. */
export function pick(
	draft: Draft,
	index: number,
	option: string,
	multi: boolean | undefined,
): Draft {
	const chosen = draft.picks[index] ?? [];
	if (!multi) return { ...draft, picks: { ...draft.picks, [index]: [option] } };
	const picked = chosen.includes(option)
		? chosen.filter((one) => one !== option)
		: [...chosen, option];
	return { ...draft, picks: { ...draft.picks, [index]: picked } };
}

/** Typing and picking are alternatives for the same question. */
export function type(draft: Draft, index: number, text: string): Draft {
	return { ...draft, typed: { ...draft.typed, [index]: text } };
}

export function ready(ask: OpenAsk, draft: Draft): boolean {
	return ask.questions.every((_, index) => {
		const typed = draft.typed[index]?.trim() ?? "";
		return typed.length > 0 || (draft.picks[index]?.length ?? 0) > 0;
	});
}

export function answerOf(ask: OpenAsk, draft: Draft): AskResult {
	return {
		answers: ask.questions.map((one, index) => {
			const typed = draft.typed[index]?.trim() ?? "";
			return {
				question: one.question,
				header: one.header,
				picked: typed.length > 0 ? [] : (draft.picks[index] ?? []),
				...(typed.length > 0 ? { typed } : {}),
				notes: [],
			};
		}),
		cancelled: false,
	};
}

export function answerAsk(client: Client, ask: OpenAsk, draft: Draft): void {
	client.send("ask.answer", { ask: ask.id, result: answerOf(ask, draft) });
}

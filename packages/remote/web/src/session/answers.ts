// The person on the phone answers the question the agent asked, and the answer travels as the same
// `AskResult` the terminal produces. This file holds the draft and the result, without a screen: a
// phone needs to be able to say "wait, I picked the wrong one" before anything is sent.

import type { AskResult, OpenAsk } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";

/** What the person has chosen so far, by question index. */
export interface Draft {
	/** The options picked, in the order they were picked. */
	picks: Record<number, string[]>;
	/** What the person typed, when they typed instead of picking. */
	typed: Record<number, string>;
}

/** Nobody has chosen anything yet. */
export const EMPTY: Draft = { picks: {}, typed: {} };

/** Picks or unpicks an option. A question that takes one answer replaces what was there. */
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

/** Types an answer. Typing and picking are alternatives for the same question, not both at once. */
export function type(draft: Draft, index: number, text: string): Draft {
	return { ...draft, typed: { ...draft.typed, [index]: text } };
}

/** Whether every question has an answer, which is what the send button waits for. */
export function ready(ask: OpenAsk, draft: Draft): boolean {
	return ask.questions.every((_, index) => {
		const typed = draft.typed[index]?.trim() ?? "";
		return typed.length > 0 || (draft.picks[index]?.length ?? 0) > 0;
	});
}

/**
 * The answer as pi expects it: one entry per question, in the order asked. A note is what the person
 * added to a picked option, and there is none until the screen offers the field.
 */
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

/**
 * Sends the answer the person built. Nothing is drawn from this: the outcome arrives as an event, like
 * every other change on this screen.
 */
export function answerAsk(client: Client, ask: OpenAsk, draft: Draft): void {
	client.send("ask.answer", { ask: ask.id, result: answerOf(ask, draft) });
}

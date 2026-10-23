import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	ANSWER,
	ASK,
	AVAILABLE,
	type AskCancel,
	type AskQuestion,
	type AskRequest,
	type AskResult,
	CANCEL,
	isAskResult,
} from "../contracts/ask.ts";
import { type By, isBy } from "../contracts/by.ts";
import { isObject } from "../decode.ts";
import { logFrom, type SessionSource } from "../events/log.ts";

type Events = ExtensionAPI["events"];

/** True when a feature in this process can draw a question right now. */
export function canAsk(events: Events): boolean {
	const probe = { available: false };
	events.emit(AVAILABLE, probe);
	return probe.available;
}

export interface AskOptions {
	/** The feature asking, as `ask.opened` records it: `ask-questions` or `ask-permission`. */
	source?: string;
	/** Closes the question unanswered. The call resolves as cancelled, and never rejects. */
	signal?: AbortSignal;
	/** Who closed it when `signal` aborts. Without it, `ask.closed` says nobody. */
	cancelledBy?: By;
	/** The session whose log gets `ask.opened` and `ask.closed`. Without it, nothing is logged. */
	ctx?: { sessionManager: Partial<SessionSource> };
	/**
	 * The request's id, when the caller already has one, such as the tool call's. Keeping it unique is
	 * the caller's job: two open asks with one id would both close on the first answer.
	 */
	id?: string;
}

/** A new one every time, so a caller that changes its result changes nobody else's. */
function aborted(): AskResult {
	return { answers: [], cancelled: true };
}

/**
 * Asks, and resolves with the first answer. Check `canAsk` first: with no provider listening and no
 * signal, the promise never settles. A provider that is listening always answers, even when it
 * fails. Once the question closes, by an answer or by `signal`, `harness:ask.cancel` tells every
 * other provider to close its dialog.
 */
export function askQuestions(
	events: Events,
	questions: readonly AskQuestion[],
	options: AskOptions = {},
): Promise<AskResult> {
	const { signal, ctx } = options;
	if (signal?.aborted) return Promise.resolve(aborted());
	const id = options.id ?? crypto.randomUUID();

	return new Promise((resolve) => {
		let open = true;
		const close = (result: AskResult, by: By | undefined, reason: AskCancel["reason"]) => {
			if (!open) return;
			open = false;
			stop();
			signal?.removeEventListener("abort", abort);
			if (ctx !== undefined)
				logFrom(ctx, events, "ask.closed", { id, result, ...(by === undefined ? {} : { by }) });
			const cancel: AskCancel = { id, reason };
			events.emit(CANCEL, cancel);
			resolve(result);
		};
		const abort = () => close(aborted(), options.cancelledBy, "aborted");
		const stop = events.on(ANSWER, (data) => {
			if (!isObject(data) || data.id !== id) return;
			close(asResult(data.result), isBy(data.by) ? data.by : undefined, "answered");
		});
		signal?.addEventListener("abort", abort, { once: true });

		if (ctx !== undefined)
			logFrom(ctx, events, "ask.opened", {
				id,
				source: options.source ?? "unknown",
				questions: [...questions],
			});
		const request: AskRequest = { id, questions: [...questions] };
		events.emit(ASK, request);
	});
}

export function asResult(value: unknown): AskResult {
	if (!isAskResult(value))
		return { answers: [], cancelled: true, error: "the answer did not decode" };
	return value;
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	ANSWER,
	ASK,
	AVAILABLE,
	type AskCancel,
	type AskQuestion,
	type AskReply,
	type AskRequest,
	type AskResult,
	CANCEL,
	isAskResult,
} from "../contracts/ask.ts";
import { type By, isBy } from "../contracts/by.ts";
import { isObject } from "../decode.ts";
import { logFrom, type LogSession } from "../events/log.ts";

type Events = ExtensionAPI["events"];

export function canAsk(events: Events): boolean {
	const probe = { available: false };
	events.emit(AVAILABLE, probe);
	return probe.available;
}

export interface AskOptions {
	source?: string;
	/** Closes the question unanswered. The call resolves as cancelled, and never rejects. */
	signal?: AbortSignal;
	/** Who closed it when `signal` aborts. Without it, `ask.closed` says nobody. */
	cancelledBy?: By;
	/** The session whose log gets `ask.opened` and `ask.closed`. Without it, nothing is logged. */
	ctx?: { sessionManager: Partial<LogSession> };
	/** Must be unique: two open asks with one id both close on the first answer. */
	id?: string;
	/** The asker draws the question in its own terminal, so the questions feature leaves it alone. */
	drawn?: true;
}

/** A new one every time, so a caller that mutates its result changes nobody else's. */
function aborted(): AskResult {
	return { answers: [], cancelled: true };
}

/** Check `canAsk` first: with no provider and no signal, the promise never settles. */
export function askQuestions(
	events: Events,
	questions: readonly AskQuestion[],
	options: AskOptions = {},
): Promise<AskReply> {
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
			const cancel: AskCancel = { id, reason, ...(by === undefined ? {} : { by }) };
			events.emit(CANCEL, cancel);
			resolve(by === undefined ? result : { ...result, by });
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
		const request: AskRequest = {
			id,
			questions: [...questions],
			...(options.drawn === true ? { drawn: true } : {}),
		};
		events.emit(ASK, request);
	});
}

function asResult(value: unknown): AskResult {
	if (!isAskResult(value))
		return { answers: [], cancelled: true, error: "the answer did not decode" };
	return value;
}

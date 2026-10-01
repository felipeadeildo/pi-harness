import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	ANSWER,
	ASK,
	AVAILABLE,
	type AskQuestion,
	type AskRequest,
	type AskResult,
	isAskResult,
} from "../contracts/ask.ts";
import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

/** True when a feature in this process can draw a question right now. */
export function canAsk(events: Events): boolean {
	const probe = { available: false };
	events.emit(AVAILABLE, probe);
	return probe.available;
}

/**
 * Asks, and resolves with the answer. Check `canAsk` first: with no provider listening, the promise
 * never settles. A provider that is listening always answers, even when it fails.
 */
export function askQuestions(
	events: Events,
	questions: readonly AskQuestion[],
): Promise<AskResult> {
	const id = crypto.randomUUID();
	return new Promise((resolve) => {
		const stop = events.on(ANSWER, (data) => {
			if (!isObject(data) || data.id !== id) return;
			stop();
			resolve(asResult(data.result));
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

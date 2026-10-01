import { expect, test } from "bun:test";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import { askQuestions, canAsk } from "../src/ask/client.ts";
import { ANSWER, ASK, AVAILABLE, type AskRequest, type AskResult } from "../src/contracts/ask.ts";

const QUESTION = {
	header: "Auth",
	question: "Which auth?",
	options: [{ label: "OAuth", description: "login", preview: "```\n[ in ]\n```" }],
};

function provider(
	bus: ReturnType<typeof createEventBus>,
	result: AskResult,
	requests: AskRequest[],
) {
	bus.on(AVAILABLE, (data: unknown) => void ((data as { available: boolean }).available = true));
	bus.on(ASK, (data: unknown) => {
		const request = data as AskRequest;
		requests.push(request);
		bus.emit(ANSWER, { id: request.id, result });
	});
}

test("with no provider the questions cannot be asked", () => {
	expect(canAsk(createEventBus())).toBe(false);
});

test("the answer comes back with the request id", async () => {
	const bus = createEventBus();
	const requests: AskRequest[] = [];
	const answer: AskResult = {
		answers: [{ question: "Which auth?", header: "Auth", picked: ["OAuth"], notes: [] }],
		cancelled: false,
	};
	provider(bus, answer, requests);

	expect(canAsk(bus)).toBe(true);
	expect(await askQuestions(bus, [QUESTION])).toEqual(answer);
	expect(requests[0]?.questions).toEqual([QUESTION]);
});

test("an answer for another request is ignored", async () => {
	const bus = createEventBus();
	provider(bus, { answers: [], cancelled: true }, []);
	bus.emit(ANSWER, { id: "another", result: { answers: [], cancelled: false } });
	expect(await askQuestions(bus, [QUESTION])).toEqual({ answers: [], cancelled: true });
});

test("an answer that does not decode becomes a cancelled result", async () => {
	const bus = createEventBus();
	bus.on(ASK, (data: unknown) => bus.emit(ANSWER, { id: (data as AskRequest).id, result: "nope" }));
	expect(await askQuestions(bus, [QUESTION])).toEqual({
		answers: [],
		cancelled: true,
		error: "the answer did not decode",
	});
});

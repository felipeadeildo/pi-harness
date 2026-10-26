import { describe, expect, test } from "bun:test";

import type { OpenAsk } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";

import { answerAsk, answerOf, EMPTY, note, pick, ready, type } from "./answers.ts";

const ask = (over: Partial<OpenAsk> = {}): OpenAsk => ({
	id: "q1",
	source: "permission",
	questions: [
		{
			header: "Deploy",
			question: "Ship it now",
			options: [{ label: "yes" }, { label: "no", description: "wait for the review" }],
		},
	],
	...over,
});

describe("the answer to a question", () => {
	test("picking one option replaces the last, unless the question takes several", () => {
		let draft = EMPTY;
		draft = pick(draft, 0, "yes", undefined);
		draft = pick(draft, 0, "no", undefined);
		expect(draft.picks[0]).toEqual(["no"]);

		const many = ask();
		many.questions[0]!.multiSelect = true;
		let both = pick(pick(EMPTY, 0, "yes", true), 0, "no", true);
		expect(both.picks[0]).toEqual(["yes", "no"]);
		// A second tap takes the pick back, which is what the screen shows as unselected.
		both = pick(both, 0, "yes", true);
		expect(both.picks[0]).toEqual(["no"]);
	});

	test("typing is the answer, so what was picked does not go along", () => {
		const one = ask();
		let draft = pick(EMPTY, 0, "yes", undefined);
		draft = type(draft, 0, "only after the review");
		expect(answerOf(one, draft).answers[0]).toEqual({
			question: "Ship it now",
			header: "Deploy",
			picked: [],
			typed: "only after the review",
			notes: [],
		});
	});

	test("an empty question is not ready, and one answer per question is what ready means", () => {
		const two: OpenAsk = {
			...ask(),
			questions: [
				...ask().questions,
				{ header: "Second", question: "And when", options: [{ label: "today" }] },
			],
		};
		const one = pick(EMPTY, 0, "yes", undefined);
		expect(ready(two, one)).toBe(false);
		const both = pick(one, 1, "today", undefined);
		expect(ready(two, both)).toBe(true);
		// Whitespace is not an answer.
		expect(ready(two, type(one, 1, "   "))).toBe(false);
	});

	test("the answer reaches the daemon as the command it is", () => {
		const sent: [string, unknown][] = [];
		const client = {
			send: (name: string, data: unknown) => void sent.push([name, data]),
		} as unknown as Client;
		answerAsk(client, ask(), pick(EMPTY, 0, "no", undefined));
		expect(sent).toHaveLength(1);
		expect(sent[0]![0]).toBe("ask.answer");
		expect(sent[0]![1]).toEqual({
			ask: "q1",
			result: {
				answers: [{ question: "Ship it now", header: "Deploy", picked: ["no"], notes: [] }],
				cancelled: false,
			},
		});
	});
});

test("a note on an option travels with the answer, picked or not, and an empty one does not", () => {
	let draft = pick(EMPTY, 0, "yes", undefined);
	draft = note(draft, 0, "yes", " because the tests passed ");
	draft = note(draft, 0, "no", "too risky");
	draft = note(draft, 0, "maybe", "  ");
	const answer = answerOf(
		{
			id: "a1",
			source: "pi",
			questions: [{ header: "Deploy", question: "Ship it now", options: [] }],
		},
		draft,
	).answers[0];
	expect(answer?.notes).toEqual([
		{ option: "yes", note: "because the tests passed" },
		{ option: "no", note: "too risky" },
	]);
});

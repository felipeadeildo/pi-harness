import { describe, expect, test } from "bun:test";

import type { AskAnswer } from "@adeildo/pi-kit";

import { answerText } from "../src/answers.ts";
import { askOverRpc, type DialogUI } from "../src/rpc.ts";
import type { Question } from "../src/schema.ts";
import { normalizeParams, problemWith } from "../src/validate.ts";

const AUTH: Question = {
	question: "Which auth?",
	header: "Auth",
	options: [
		{ label: "OAuth", description: "login" },
		{ label: "API key", description: "env" },
	],
};

const MANY: Question = { ...AUTH, question: "Which ones?", header: "Many", multiSelect: true };

describe("validation", () => {
	test("questions that can be asked pass", () => {
		expect(problemWith({ questions: [AUTH, MANY] })).toBeUndefined();
	});

	test("a free-answer option is refused, since the dialog has one", () => {
		const other = { ...AUTH, options: [...AUTH.options, { label: "Other", description: "" }] };
		expect(problemWith({ questions: [other] })).toContain("reserved");
	});

	test("the same question twice is refused", () => {
		expect(problemWith({ questions: [AUTH, AUTH] })).toContain("asked twice");
	});

	test("the same label twice is refused", () => {
		const twice = { ...AUTH, options: [AUTH.options[0]!, AUTH.options[0]!] };
		expect(problemWith({ questions: [twice] })).toContain("listed twice");
	});

	test("a carriage return cannot hide a reserved label", () => {
		const sneaky = { ...AUTH, options: [...AUTH.options, { label: "Oth\rer", description: "" }] };
		expect(problemWith(normalizeParams({ questions: [sneaky] }))).toContain("reserved");
	});

	test("a CRLF keeps its line break in a preview", () => {
		const withPreview = {
			...AUTH,
			options: [{ label: "A", description: "a", preview: "one\r\ntwo" }, AUTH.options[1]!],
		};
		const [question] = normalizeParams({ questions: [withPreview] }).questions;
		expect(question?.options[0]?.preview).toBe("one\ntwo");
		expect(question?.options[1]).not.toHaveProperty("preview");
	});
});

describe("the text the model reads", () => {
	const picked: AskAnswer = {
		question: AUTH.question,
		header: "Auth",
		picked: ["OAuth"],
		notes: [
			{ option: "OAuth", note: "we have it" },
			{ option: "API key", note: "leaks" },
		],
	};

	test("lists picks and notes, marking the notes on options not picked", () => {
		const text = answerText({ answers: [picked], cancelled: false }, [AUTH]);
		expect(text).toBe(
			[
				"The user answered:",
				'- Auth: "Which auth?" → "OAuth"',
				'  note on "OAuth": we have it',
				'  note on "API key" (not picked): leaks',
				"Continue with these answers in mind.",
			].join("\n"),
		);
	});

	test("names the questions left unanswered", () => {
		const text = answerText({ answers: [picked], cancelled: false }, [AUTH, MANY]);
		expect(text).toContain('Left unanswered: "Which ones?"');
	});

	test("a typed answer reads in the user's words", () => {
		const typed: AskAnswer = { ...picked, picked: [], typed: "mTLS", notes: [] };
		expect(answerText({ answers: [typed], cancelled: false }, [AUTH])).toContain(
			'→ in their words: "mTLS"',
		);
	});

	test("closing says not to assume, and keeps what was answered", () => {
		const text = answerText({ answers: [picked], cancelled: true }, [AUTH, MANY]);
		expect(text).toContain("Do not assume an answer");
		expect(text).toContain('"OAuth"');
	});

	test("questions that never showed are not a decline", () => {
		const text = answerText({ answers: [], cancelled: true, error: "There is no UI" }, []);
		expect(text).toContain("not a decline");
	});
});

function scripted(replies: (string | undefined)[]): DialogUI & { titles: string[] } {
	const titles: string[] = [];
	const next = async (title: string) => {
		titles.push(title);
		return replies.shift();
	};
	return { titles, select: next, input: next };
}

describe("over RPC", () => {
	test("a single choice is a select", async () => {
		const ui = scripted(["2. API key: env"]);
		const result = await askOverRpc(ui, [AUTH]);
		expect(result).toEqual({
			cancelled: false,
			answers: [{ question: AUTH.question, header: "Auth", picked: ["API key"], notes: [] }],
		});
	});

	test("the last row asks for a typed answer", async () => {
		const ui = scripted(["3. Type something.", "mTLS"]);
		const result = await askOverRpc(ui, [AUTH]);
		expect(result.answers[0]?.typed).toBe("mTLS");
	});

	test("several picks are numbers, anything else is a typed answer", async () => {
		expect((await askOverRpc(scripted(["1, 2"]), [MANY])).answers[0]?.picked).toEqual([
			"OAuth",
			"API key",
		]);
		expect((await askOverRpc(scripted(["both"]), [MANY])).answers[0]?.typed).toBe("both");
	});

	test("a dismissed dialog cancels the rest", async () => {
		const result = await askOverRpc(scripted(["1. OAuth: login", undefined]), [AUTH, MANY]);
		expect(result.cancelled).toBe(true);
		expect(result.answers).toHaveLength(1);
	});
});

import { beforeAll, describe, expect, test } from "bun:test";

import type { AskResult } from "@adeildo/pi-kit";
import { getMarkdownTheme, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type KeybindingsManager, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import type { Question } from "../src/schema.ts";
import { QuestionDialog } from "../src/ui/dialog.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

const KEYS = {
	up: "\x1b[A",
	down: "\x1b[B",
	left: "\x1b[D",
	right: "\x1b[C",
	enter: "\r",
	tab: "\t",
	esc: "\x1b",
	space: " ",
};

const NO_BINDINGS = { matches: () => false } as unknown as KeybindingsManager;
const TUI_STUB = {
	requestRender: () => {},
	terminal: { rows: 40, columns: 120 },
} as unknown as TUI;

const AUTH: Question = {
	question: "Which auth method?",
	header: "Auth",
	options: [
		{ label: "OAuth", description: "The provider's login", preview: "```\n[ Sign in ]\n```" },
		{ label: "API key", description: "A key in the env" },
	],
};

const FEATURES: Question = {
	question: "Which features?",
	header: "Features",
	multiSelect: true,
	options: [
		{ label: "Search", description: "Find things" },
		{ label: "Export", description: "Save things" },
		{ label: "Share", description: "Send things" },
	],
};

beforeAll(() => initTheme("dark", false));

function open(...questions: Question[]) {
	const results: AskResult[] = [];
	const dialog = new QuestionDialog({
		tui: TUI_STUB,
		theme: plain,
		markdownTheme: getMarkdownTheme(),
		keybindings: NO_BINDINGS,
		questions,
		complete: (result) => results.push(result),
	});
	dialog.focused = true;
	return { dialog, results };
}

function press(dialog: QuestionDialog, ...keys: string[]): void {
	for (const key of keys) dialog.handleInput(key);
}

function type(dialog: QuestionDialog, text: string): void {
	for (const char of text) dialog.handleInput(char);
}

describe("one question", () => {
	test("enter picks the focused option and ends the dialog", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.down, KEYS.enter);
		expect(results).toEqual([
			{
				cancelled: false,
				answers: [{ question: AUTH.question, header: "Auth", picked: ["API key"], notes: [] }],
			},
		]);
	});

	test("a number moves to its option", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "2", KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["API key"]);
	});

	test("esc closes without submitting", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.esc);
		expect(results).toEqual([{ cancelled: true, answers: [] }]);
	});

	test("the typed row takes an answer in your own words", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "3");
		type(dialog, "neither, use mTLS");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers[0]).toEqual({
			question: AUTH.question,
			header: "Auth",
			picked: [],
			typed: "neither, use mTLS",
			notes: [],
		});
	});

	test("an empty typed row does not answer", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "3", KEYS.enter);
		expect(results).toEqual([]);
	});

	test("esc on the typed row goes back to the options", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, "3", KEYS.esc, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["API key"]);
	});
});

describe("notes", () => {
	test("a note rides on the picked option", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.tab);
		type(dialog, "we already have it");
		press(dialog, KEYS.enter, KEYS.enter);
		expect(results[0]?.answers[0]).toEqual({
			question: AUTH.question,
			header: "Auth",
			picked: ["OAuth"],
			notes: [{ option: "OAuth", note: "we already have it" }],
		});
	});

	test("an option you did not pick keeps its note too", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.down, KEYS.tab);
		type(dialog, "keys leak");
		press(dialog, KEYS.tab, KEYS.up, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["OAuth"]);
		expect(results[0]?.answers[0]?.notes).toEqual([{ option: "API key", note: "keys leak" }]);
	});

	test("arrows in a note move to the next option's note", () => {
		const { dialog, results } = open(AUTH);
		press(dialog, KEYS.tab);
		type(dialog, "yes");
		press(dialog, KEYS.down);
		type(dialog, "no");
		press(dialog, KEYS.enter, KEYS.up, KEYS.enter);
		expect(results[0]?.answers[0]?.notes).toEqual([
			{ option: "OAuth", note: "yes" },
			{ option: "API key", note: "no" },
		]);
	});

	test("a note is shown under its option", () => {
		const { dialog } = open(AUTH);
		press(dialog, KEYS.tab);
		type(dialog, "we already have it");
		press(dialog, KEYS.enter);
		expect(dialog.render(80).join("\n")).toContain("note we already have it");
	});
});

describe("several picks", () => {
	test("space ticks, enter confirms", () => {
		const { dialog, results } = open(FEATURES);
		press(dialog, KEYS.space, KEYS.down, KEYS.down, KEYS.space, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["Search", "Share"]);
	});

	test("enter with nothing ticked takes the focused option", () => {
		const { dialog, results } = open(FEATURES);
		press(dialog, KEYS.down, KEYS.enter);
		expect(results[0]?.answers[0]?.picked).toEqual(["Export"]);
	});

	test("a typed answer comes with the picks", () => {
		const { dialog, results } = open(FEATURES);
		press(dialog, KEYS.space, "4");
		type(dialog, "and print");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers[0]).toMatchObject({ picked: ["Search"], typed: "and print" });
	});
});

describe("several questions", () => {
	test("answering moves to the next question, then to submit", () => {
		const { dialog, results } = open(AUTH, FEATURES);
		press(dialog, KEYS.enter);
		expect(dialog.render(80).join("\n")).toContain("Which features?");
		press(dialog, KEYS.enter);
		expect(dialog.render(80).join("\n")).toContain("Review your answers");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers.map((answer: { picked: string[] }) => answer.picked)).toEqual([
			["OAuth"],
			["Search"],
		]);
		expect(results[0]?.cancelled).toBe(false);
	});

	test("the submit tab names what is left unanswered", () => {
		const { dialog, results } = open(AUTH, FEATURES);
		press(dialog, KEYS.enter);
		press(dialog, KEYS.right);
		const text = dialog.render(80).join("\n");
		expect(text).toContain("not answered");
		expect(text).toContain("1 question goes back unanswered");
		press(dialog, KEYS.enter);
		expect(results[0]?.answers).toHaveLength(1);
	});

	test("arrows switch questions and keep what was picked", () => {
		const { dialog } = open(AUTH, FEATURES);
		press(dialog, KEYS.down, KEYS.enter, KEYS.left);
		expect(dialog.render(80).join("\n")).toContain("\u276f 2  API key \u2713");
	});
});

describe("drawing", () => {
	test("every line is exactly the width, the typed row's editor included", () => {
		const { dialog } = open(AUTH, FEATURES);
		for (const width of [40, 80, 120]) {
			for (const line of dialog.render(width)) expect(visibleWidth(line)).toBe(width);
		}
		press(dialog, "3");
		type(dialog, "a long answer that has to wrap inside the editor box");
		for (const line of dialog.render(60)) expect(visibleWidth(line)).toBe(60);
	});

	test("a wide terminal puts the preview beside the options", () => {
		const { dialog } = open(AUTH);
		const lines = dialog.render(120);
		const row = lines.find((line) => line.includes("OAuth"));
		expect(row).toContain("\u250c");
		expect(lines.join("\n")).toContain("[ Sign in ]");
	});

	test("a narrow terminal puts it below", () => {
		const { dialog } = open(AUTH);
		const lines = dialog.render(70);
		const optionRow = lines.findIndex((line) => line.includes("OAuth"));
		const boxRow = lines.findIndex((line) => line.includes("\u250c"));
		expect(boxRow).toBeGreaterThan(optionRow);
	});

	test("an option with no preview says so", () => {
		const { dialog } = open(AUTH);
		press(dialog, KEYS.down);
		expect(dialog.render(120).join("\n")).toContain("no preview for this option");
	});
});

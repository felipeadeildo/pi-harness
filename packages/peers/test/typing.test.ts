import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Named } from "../src/names.ts";
import { TypingWidget, WAITING_SHOWN, waitingLines, writingMarks } from "../src/ui/typing.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const names = new Map<string, Named>([
	["a", { session: "a", handle: "oauth", color: "syntaxString" } as Named],
	["b", { session: "b", handle: "migration", color: "syntaxType" } as Named],
	["c", { session: "c", handle: "docs", color: "syntaxNumber" } as Named],
]);
const folder = { session: "c", names: () => ({ bySession: names, aliases: new Map() }) };
const source = {
	othersTyping: () => [],
	queued: () => [],
	here: (room: string | undefined) => (room === undefined || room === "r1" ? folder : undefined),
	rooms: () => [
		{ id: undefined, mode: "in" as const, name: "repo", folders: [], sessions: [] },
		{ id: "r1", mode: "in" as const, name: "backend+frontend", folders: [], sessions: [] },
	],
};

describe("someone writing to the room", () => {
	test("is a line for the footer, not a frame over the editor", () => {
		const marks = writingMarks(
			[{ session: "a", to: "@docs, @migration", text: "", at: 0 }],
			source,
		);
		expect(marks).toEqual([{ handle: "oauth", color: "syntaxString", to: "you, @migration" }]);
	});

	test("a draft to everyone says so, and one in a shared room still resolves its names", () => {
		const marks = writingMarks(
			[
				{ session: "b", to: "everyone", text: "", at: 0 },
				{ session: "a", to: "@docs", text: "", at: 0, room: "r1" },
			],
			source,
		);
		expect(marks).toEqual([
			{ handle: "migration", color: "syntaxType", to: "everyone" },
			{ handle: "oauth", color: "syntaxString", to: "you" },
		]);
	});
});

describe("a message sent to this agent and not read yet", () => {
	const waiting = {
		id: "m1",
		from: "oauth",
		color: "syntaxString",
		fromYou: false,
		toYou: true,
		text: "one\n\ntwo\nthree\nfour",
		at: 0,
		mode: "steered" as const,
	};

	test("keeps the dashed frame and says when the agent gets it", () => {
		const lines = waitingLines([waiting], plain, 80);
		expect(lines[0]?.startsWith("╭┄")).toBe(true);
		expect(lines[0]).toContain("@oauth → you");
		expect(lines[0]).toContain("between calls");
		expect(waitingLines([{ ...waiting, mode: "after-run" }], plain, 80)[0]).toContain(
			"after this run",
		);
	});

	test("shows its first lines, without the blank ones, and how many more there are", () => {
		const body = waitingLines([waiting], plain, 80).slice(1, -1).join("\n");
		expect(body).toContain("one");
		expect(body).toContain("two");
		expect(body).not.toContain("three");
		expect(body).toContain("2 more lines");
	});

	test("a draft from someone else takes no line over the editor", () => {
		// The editor is where you type: a frame that comes for a message not meant for you moves it.
		const widget = new TypingWidget(
			{ ...source, othersTyping: () => [{ session: "a", to: "@docs", text: "hi", at: 0 }] },
			plain,
			() => {},
		);
		try {
			expect(widget.render(80)).toEqual([]);
		} finally {
			widget.dispose();
		}
	});

	test("while a message waits for this session, the frame keeps its height", () => {
		const widget = new TypingWidget({ ...source, queued: () => [waiting] }, plain, () => {});
		try {
			const first = widget.render(80);
			// The words it shows, and the two dashed lines around them: never more, never fewer.
			expect(first).toHaveLength(WAITING_SHOWN + 2);
			expect(widget.render(80)).toEqual(first);
			expect(widget.render(80)).toEqual(first);
		} finally {
			widget.dispose();
		}
	});
});

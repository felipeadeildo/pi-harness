import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Named } from "../src/names.ts";
import { typingLines, waitingLines } from "../src/ui/typing.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const names = new Map<string, Named>([
	["a", { session: "a", handle: "oauth", color: "syntaxString" } as Named],
	["b", { session: "b", handle: "migration", color: "syntaxType" } as Named],
	["c", { session: "c", handle: "docs", color: "syntaxNumber" } as Named],
]);
const folder = { session: "c", names: () => names };
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
	test("a draft wears the dashed frame, who writes to whom on top", () => {
		const lines = typingLines(
			[{ session: "a", to: "@docs, @migration", text: "", at: 0 }],
			source,
			plain,
			80,
			0,
		);
		expect(lines[0]?.startsWith("╭┄")).toBe(true);
		expect(lines[0]).toContain("@oauth → you, @migration");
		expect(lines.join("\n")).toContain("writing");
		expect(lines.at(-1)?.startsWith("╰┄")).toBe(true);
	});

	test("a long draft keeps its newest words, inside the frame", () => {
		const text = `${"old words ".repeat(20)}the newest part`;
		const lines = typingLines(
			[{ session: "b", to: "everyone", text, at: 0 }],
			source,
			plain,
			70,
			0,
		);
		expect(lines.join("\n")).toContain("the newest part");
		expect(lines.every((line) => line.length <= 70)).toBe(true);
	});

	test("a draft in a shared room says which", () => {
		const lines = typingLines(
			[{ session: "a", to: "@docs", text: "", at: 0, room: "r1" }],
			source,
			plain,
			80,
			0,
		);
		expect(lines[0]).toContain("@oauth → you in backend+frontend");
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
});

import { describe, expect, test } from "bun:test";

import type { TranscriptItem } from "@adeildo/pi-remote-protocol";

import { changesOf, commandTitle, countsOf, spanOf } from "./steps.ts";
import { blocksOf, liveBlocksOf, partialArgs, skillsIn, type StepLine } from "./turns.ts";

function message(entry: string, at: string, value: Record<string, unknown>): TranscriptItem {
	return { kind: "message", entry, at, message: value as never };
}

describe("the transcript's steps", () => {
	test("a call takes its time from its message to its result, and a thought its time as seen", () => {
		const items = [
			message("u1", "2026-10-26T10:00:00.000Z", { role: "user", content: "go" }),
			message("a1", "2026-10-26T10:00:01.000Z", {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "first, look" },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				],
			}),
			message("r1", "2026-10-26T10:00:03.500Z", {
				role: "toolResult",
				toolCallId: "t1",
				content: [{ type: "text", text: "a.ts" }],
			}),
		];
		const [, steps] = blocksOf(items, undefined, { "a1:0": 1_200 });
		expect(steps?.kind).toBe("steps");
		const lines = steps?.kind === "steps" ? steps.lines : [];
		expect(lines[0]).toMatchObject({ kind: "thought", durationMs: 1_200 });
		expect(lines[1]).toMatchObject({ kind: "tool", status: "done", durationMs: 2_500 });
	});

	test("only the last part of an answer still being written is being written", () => {
		const blocks = liveBlocksOf({
			tools: {},
			message: {
				stream: 3,
				ended: false,
				parts: [
					{ kind: "thinking", text: "hm", since: 1_000, until: 1_800 },
					{
						kind: "toolCall",
						text: '{"path":"/a.ts","content":"x',
						id: "t2",
						name: "write",
						since: 2_000,
					},
				],
			},
		});
		const lines = blocks[0]?.kind === "steps" ? blocks[0].lines : [];
		expect(lines[0]).toMatchObject({ kind: "thought", streaming: false, durationMs: 800 });
		expect(lines[1]).toMatchObject({
			status: "writing",
			startedAt: 2_000,
			args: { path: "/a.ts" },
		});
	});

	test("a pi-skills message reads as the skills it loaded", () => {
		const text =
			'<skill name="simplify" location="/s/SKILL.md">\nReferences are relative to /s.\n\n# Simplify\n</skill>';
		expect(skillsIn(text)).toEqual([{ name: "simplify", text: "# Simplify" }]);
		const items: TranscriptItem[] = [
			{
				kind: "custom",
				entry: "c1",
				customType: "pi-skills",
				data: [{ type: "text", text }],
				display: true,
			},
		];
		expect(blocksOf(items, undefined)).toMatchObject([
			{ kind: "skills", skills: [{ name: "simplify" }] },
		]);
	});

	test("arguments still streaming read as far as they go", () => {
		expect(partialArgs('{"path":"/a.ts","content":"line one\\nli')).toEqual({
			path: "/a.ts",
			content: "line one\nli",
		});
		expect(partialArgs("{")).toEqual({});
	});
});

describe("a run of steps", () => {
	const tool = (name: string, startedAt: number, durationMs: number): StepLine => ({
		kind: "tool",
		id: `${name}-${startedAt}`,
		name,
		args: {},
		status: "done",
		startedAt,
		durationMs,
	});

	test("says what it did, by kind, and how long from its first step to its last", () => {
		const lines = [
			tool("bash", 0, 500),
			tool("bash", 600, 400),
			tool("edit", 1_000, 50),
			tool("peers", 1_100, 10),
		];
		expect(countsOf(lines)).toBe("2 commands, 1 edit, 1 peers");
		expect(spanOf(lines, undefined)).toBe(1_110);
		expect(spanOf(lines, 5_000)).toBe(5_000);
		expect(
			spanOf([{ kind: "thought", id: "t", text: "", streaming: false }], undefined),
		).toBeUndefined();
	});

	test("names a command without the cd into its folder, and an edit by its lines", () => {
		expect(commandTitle("cd /repo && bun test")).toBe("bun test");
		expect(commandTitle("git status\ngit diff")).toBe("git status …");
		expect(changesOf("--- a\n+++ b\n@@\n-old\n+new\n+more")).toBe("+2 −1");
	});
});

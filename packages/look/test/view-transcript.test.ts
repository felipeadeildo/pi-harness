import { beforeAll, describe, expect, test } from "bun:test";

import { initTheme, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { transcriptOf } from "../src/view/transcript.ts";

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as unknown as TUI;
const options = { tui, cwd: "/work", expanded: false };

let next = 0;
function entry(parentId: string | null, fields: Record<string, unknown>): SessionEntry {
	next++;
	return { id: `e${next}`, parentId, timestamp: "t", ...fields } as SessionEntry;
}

function message(parentId: string | null, body: Record<string, unknown>): SessionEntry {
	return entry(parentId, { type: "message", message: { timestamp: 0, ...body } });
}

function text(entries: SessionEntry[], leaf?: string): string {
	return (
		transcriptOf(entries, leaf, options)
			.flatMap((component) => component.render(80))
			.join("\n")
			// oxlint-disable-next-line no-control-regex -- the escapes pi's components color with
			.replace(/\x1b\[[0-9;]*m/g, "")
	);
}

describe("another session's transcript", () => {
	beforeAll(() => initTheme("dark", false));

	test("draws the conversation and a tool call with its result", () => {
		const ask = message(null, { role: "user", content: "list the files" });
		const answer = message(ask.id, {
			role: "assistant",
			content: [
				{ type: "text", text: "Looking." },
				{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } },
			],
			provider: "anthropic",
			model: "opus",
			stopReason: "toolUse",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
		});
		const result = message(answer.id, {
			role: "toolResult",
			toolCallId: "c1",
			toolName: "bash",
			content: [{ type: "text", text: "README.md" }],
			isError: false,
		});
		const drawn = text([ask, answer, result]);
		expect(drawn).toContain("list the files");
		expect(drawn).toContain("Looking.");
		expect(drawn).toContain("ls");
		expect(drawn).toContain("README.md");
	});

	test("draws only the branch that ends at the leaf", () => {
		const root = message(null, { role: "user", content: "first" });
		const left = message(root.id, { role: "user", content: "the abandoned branch" });
		const right = message(root.id, { role: "user", content: "the kept branch" });
		const drawn = text([root, left, right], right.id);
		expect(drawn).toContain("the kept branch");
		expect(drawn).not.toContain("the abandoned branch");
	});

	test("a call in an aborted answer reads as aborted, not as waiting", () => {
		const answer = message(null, {
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "sleep 9" } }],
			provider: "anthropic",
			model: "opus",
			stopReason: "aborted",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
		});
		expect(text([answer])).toContain("Operation aborted");
	});
});

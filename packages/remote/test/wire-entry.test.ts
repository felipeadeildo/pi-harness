import { expect, test } from "bun:test";

import { cut, WIRE_TEXT, wireEntry } from "../src/bridge/wire-entry.ts";

const long = Array.from({ length: 4000 }, (_, at) => `line ${at}`).join("\n");

test("a long tool output keeps its first and last lines and says how much went", () => {
	const shown = cut(long);
	expect(shown.length).toBeLessThan(WIRE_TEXT + 200);
	expect(shown.startsWith("line 0\n")).toBe(true);
	expect(shown.endsWith("line 3999")).toBe(true);
	expect(shown).toMatch(/\n… \d+ KB not sent to this screen …\n/);
	expect(cut("short")).toBe("short");
});

test("only a tool's result and a shell's output are cut, and the entry keeps its other fields", () => {
	const result = {
		id: "e1",
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: "t1",
			content: [
				{ type: "text", text: long },
				{ type: "image", data: "x" },
			],
		},
	};
	const sent = wireEntry(result);
	expect(sent.message.toolCallId).toBe("t1");
	expect(sent.message.content[0]?.text?.length).toBeLessThan(long.length);
	expect(sent.message.content[1]).toEqual({ type: "image", data: "x" });
	expect(
		wireEntry({ type: "message", message: { role: "bashExecution", output: long } }).message.output,
	).not.toBe(long);
	const answer = {
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: long }] },
	};
	expect(wireEntry(answer)).toBe(answer);
});

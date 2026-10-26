import { describe, expect, test } from "bun:test";

import type { QueuedMessage } from "@adeildo/pi-remote-protocol";

import { QUEUED_CHARS, queuedLines, withdraw } from "./pending.ts";

const message = (over: Partial<QueuedMessage> = {}): QueuedMessage => ({
	id: "q1",
	by: { kind: "client", name: "phone", machine: "box" },
	text: "ship it",
	want: "idle" as never,
	when: 0,
	...over,
});

describe("the session's queue", () => {
	test("a line says what is held, who holds it and in which order", () => {
		const lines = queuedLines([
			message(),
			message({
				id: "q2",
				text: "and then",
				by: { kind: "client", name: "laptop", machine: "desk" },
			}),
		]);
		expect(lines.map((line) => line.id)).toEqual(["q1", "q2"]);
		expect(lines[0]).toEqual({ id: "q1", text: "ship it", by: "phone" });
		expect(lines[1]?.by).toBe("laptop");
	});

	test("a wall of text is cut, so one message cannot take the screen", () => {
		const long = "x".repeat(QUEUED_CHARS * 2);
		const [line] = queuedLines([message({ text: long })]);
		expect(line?.text).toHaveLength(QUEUED_CHARS);
		expect(line?.text.endsWith("…")).toBe(true);
	});

	test("an empty queue draws nothing at all", () => {
		expect(queuedLines([])).toEqual([]);
	});
});

describe("withdrawing one message", () => {
	test("names the message it takes, so the act removes one line and not the whole list", () => {
		const sent: [string, unknown][] = [];
		const client = { send: (type: string, data: unknown) => void sent.push([type, data]) };
		withdraw(client as never, "q2");
		expect(sent).toEqual([["queue.clear", { ids: ["q2"] }]]);
	});
});

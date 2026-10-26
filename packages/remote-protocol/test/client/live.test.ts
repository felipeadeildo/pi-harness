import { describe, expect, test } from "bun:test";

import { foldLive, liveFromOpening, NOTHING_LIVE, settledBy } from "../../src/client/live.ts";
import { readEnvelope, sessionOf } from "../../src/client/session.ts";
import { envelope } from "../../src/index.ts";

const at = { machine: "m", session: "s1", epoch: "e1" };

function update(type: string, contentIndex: number, extra: Record<string, unknown> = {}) {
	return { type: "message_update", assistantMessageEvent: { type, contentIndex, ...extra } };
}

describe("the answer being written", () => {
	test("grows from the deltas, part by part, and ends with the message pi sends", () => {
		let live = foldLive(
			NOTHING_LIVE,
			"pi.message_start",
			{ stream: 1, message: { content: [] } },
			0,
		);
		live = foldLive(live, "pi.message_update", update("thinking_start", 0), 0);
		live = foldLive(live, "pi.message_update", update("thinking_delta", 0, { delta: "hm, " }), 0);
		live = foldLive(live, "pi.message_update", update("thinking_delta", 0, { delta: "ok" }), 0);
		live = foldLive(live, "pi.message_update", update("text_delta", 1, { delta: "Hi" }), 0);
		live = foldLive(
			live,
			"pi.message_update",
			update("toolcall_start", 2, { id: "t1", toolName: "bash" }),
			0,
		);
		live = foldLive(
			live,
			"pi.message_update",
			update("toolcall_delta", 2, { delta: '{"command":' }),
			0,
		);
		expect(live.message?.parts).toMatchObject([
			{ kind: "thinking", text: "hm, ok" },
			{ kind: "text", text: "Hi" },
			{ kind: "toolCall", text: '{"command":', id: "t1", name: "bash" },
		]);

		const message = { content: [{ type: "text", text: "Hi there" }] };
		live = foldLive(live, "pi.message_end", { stream: 1, message }, 0);
		expect(live.message).toMatchObject({
			stream: 1,
			parts: [{ kind: "text", text: "Hi there" }],
			ended: true,
		});
	});

	test("a thought's time is kept by its entry once pi writes the answer", () => {
		let live = foldLive(NOTHING_LIVE, "pi.message_start", { stream: 1, message: {} }, 0);
		live = foldLive(live, "pi.message_update", update("thinking_start", 0), 1_000);
		live = foldLive(live, "pi.message_update", update("thinking_delta", 0, { delta: "hm" }), 2_500);
		const message = { content: [{ type: "thinking", thinking: "hm" }] };
		live = foldLive(live, "pi.message_end", { stream: 1, message }, 3_000);
		live = settledBy(live, { type: "message", id: "e9", message: { role: "assistant" } });
		expect(live.message).toBeUndefined();
		expect(live.thought).toEqual({ "e9:0": 1_500 });
	});

	test("a tool call found half written keeps what it had, since its deltas no longer append", () => {
		const half = { type: "toolCall", id: "t1", name: "write", arguments: { path: "/a" } };
		let live = liveFromOpening(NOTHING_LIVE, { stream: 2, message: { content: [half] } });
		live = foldLive(live, "pi.message_update", update("toolcall_delta", 0, { delta: "bc" }), 0);
		expect(live.message?.parts[0]?.text).toBe('{"path":"/a"}');
		const raw = { ...half, partialJson: '{"path":"/a","content":"x' };
		live = liveFromOpening(NOTHING_LIVE, { stream: 2, message: { content: [raw] } });
		live = foldLive(live, "pi.message_update", update("toolcall_delta", 0, { delta: "yz" }), 0);
		expect(live.message?.parts[0]?.text).toBe('{"path":"/a","content":"xyz');
	});

	test("an update with no answer open, or that does not decode, changes nothing", () => {
		expect(
			foldLive(NOTHING_LIVE, "pi.message_update", update("text_delta", 0, { delta: "x" }), 0),
		).toBe(NOTHING_LIVE);
		const open = foldLive(NOTHING_LIVE, "pi.message_start", { stream: 1, message: {} }, 0);
		expect(foldLive(open, "pi.message_update", { assistantMessageEvent: "?" }, 0)).toBe(open);
	});

	test("an opening carries the answer in progress, and one without it clears what was left", () => {
		const streaming = { stream: 4, message: { content: [{ type: "text", text: "half" }] } };
		const live = liveFromOpening(NOTHING_LIVE, streaming);
		expect(live.message?.parts).toEqual([{ kind: "text", text: "half" }]);
		expect(liveFromOpening(live, undefined).message).toBeUndefined();
	});
});

describe("a running tool", () => {
	test("shows the end of its output while it runs and how it ended, until its result is written", () => {
		let live = foldLive(
			NOTHING_LIVE,
			"pi.tool_execution_start",
			{ toolCallId: "t1", toolName: "bash" },
			50,
		);
		live = foldLive(
			live,
			"pi.tool_execution_update",
			{ toolCallId: "t1", output: { text: "a\nb", truncated: true } },
			60,
		);
		expect(live.tools.t1).toEqual({
			id: "t1",
			name: "bash",
			startedAt: 50,
			output: "a\nb",
			truncated: true,
		});
		live = foldLive(
			live,
			"pi.tool_execution_end",
			{
				toolCallId: "t1",
				isError: true,
				durationMs: 900,
				output: { text: "boom", truncated: false },
			},
			70,
		);
		expect(live.tools.t1?.ended).toEqual({ error: true, durationMs: 900 });

		const result = { type: "message", message: { role: "toolResult", toolCallId: "t1" } };
		expect(settledBy(live, result).tools).toEqual({});
	});

	test("the assistant's entry ends the answer being written", () => {
		const live = foldLive(NOTHING_LIVE, "pi.message_start", { stream: 1, message: {} }, 0);
		const written = { type: "message", message: { role: "assistant", content: [] } };
		expect(settledBy(live, written).message).toBeUndefined();
		expect(settledBy(live, { type: "message", message: { role: "user" } })).toBe(live);
	});
});

describe("the session reads them", () => {
	test("from the socket, with pi's changes of model, thinking and name", () => {
		let session = sessionOf({ machine: "m", session: "s1" });
		const read = (one: ReturnType<typeof envelope>) => {
			const next = readEnvelope(session, one);
			if (next.read === "now") session = next.session;
			return next.read;
		};
		const opening = {
			summary: { session: "s1", machine: "m", cwd: "/r", kind: "terminal" },
			entries: [],
			streaming: { stream: 2, message: { content: [{ type: "text", text: "so far" }] } },
		};
		expect(read(envelope("event", "state", opening, { ...at, seq: 0 }))).toBe("now");
		expect(session.live.message?.parts[0]?.text).toBe("so far");

		read(
			envelope(
				"event",
				"pi.tool_execution_start",
				{ toolCallId: "t9", toolName: "read" },
				{ ...at, seq: 1 },
			),
		);
		read(
			envelope(
				"event",
				"pi.model_select",
				{ model: { provider: "p", id: "m2" } },
				{ ...at, seq: 2 },
			),
		);
		read(envelope("event", "pi.thinking_level_select", { level: "high" }, { ...at, seq: 3 }));
		read(envelope("event", "pi.session_info_changed", { name: "Fix the list" }, { ...at, seq: 4 }));
		expect(Object.keys(session.live.tools)).toEqual(["t9"]);
		expect(session.state).toMatchObject({
			model: { provider: "p", id: "m2" },
			thinkingLevel: "high",
			name: "Fix the list",
		});
		expect(session.cursor.seq).toBe(4);
	});
});

import { describe, expect, test } from "bun:test";

import type {
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import {
	DELTA_WINDOW_MS,
	LiveStream,
	OUTPUT_EVERY_MS,
	OUTPUT_TAIL,
	outputTail,
	type Send,
} from "../src/bridge/stream.ts";

interface Sent {
	type: string;
	/** What reaches the daemon: the data as JSON reads it back. */
	data: ReturnType<typeof JSON.parse>;
	droppable: boolean;
}

function recorded(now: () => number = () => 0) {
	const sent: Sent[] = [];
	const send: Send = (type, data, options) => {
		sent.push({
			type,
			data: JSON.parse(JSON.stringify(data)),
			droppable: options?.droppable === true,
		});
		return true;
	};
	return { sent, stream: new LiveStream(send, now) };
}

function message(role: string, text = "") {
	return {
		role,
		content: text === "" ? [] : [{ type: "text", text }],
		usage: { output: text.length },
	};
}

function start(role = "assistant"): MessageStartEvent {
	return { type: "message_start", message: message(role) } as unknown as MessageStartEvent;
}

function end(role = "assistant", text = "done"): MessageEndEvent {
	return { type: "message_end", message: message(role, text) } as unknown as MessageEndEvent;
}

function update(inner: Record<string, unknown>, text = ""): MessageUpdateEvent {
	return {
		type: "message_update",
		message: message("assistant", text),
		assistantMessageEvent: { partial: message("assistant", text), ...inner },
	} as unknown as MessageUpdateEvent;
}

function delta(text: string, contentIndex = 0, type = "text_delta"): MessageUpdateEvent {
	return update({ type, contentIndex, delta: text });
}

function toolStart(id = "call1"): ToolExecutionStartEvent {
	return {
		type: "tool_execution_start",
		toolCallId: id,
		toolName: "bash",
		args: { command: "ls" },
	};
}

function toolUpdate(text: string, id = "call1"): ToolExecutionUpdateEvent {
	return {
		type: "tool_execution_update",
		toolCallId: id,
		toolName: "bash",
		args: { command: "ls" },
		partialResult: { content: [{ type: "text", text }], details: { big: "x".repeat(100) } },
	};
}

function toolEnd(text: string, id = "call1"): ToolExecutionEndEvent {
	return {
		type: "tool_execution_end",
		toolCallId: id,
		toolName: "bash",
		result: { content: [{ type: "text", text }] },
		isError: false,
		durationMs: 12,
	};
}

function turnEnd(entry: string): TurnEndEvent {
	return {
		type: "turn_end",
		messageEntryId: entry,
		toolResultEntryIds: [],
	} as unknown as TurnEndEvent;
}

describe("the message being written", () => {
	test("streams under a number, with its deltas joined until something else comes", () => {
		const { sent, stream } = recorded();
		stream.messageStart(start());
		stream.messageUpdate(delta("a"));
		stream.messageUpdate(delta("b"));
		stream.messageUpdate(delta("c"));
		expect(sent.map((one) => one.type)).toEqual(["pi.message_start"]);
		stream.messageUpdate(update({ type: "text_end", contentIndex: 0, content: "abc" }, "abc"));
		stream.messageEnd(end("assistant", "abc"));
		expect(sent.map((one) => [one.type, one.droppable])).toEqual([
			["pi.message_start", false],
			["pi.message_update", true],
			["pi.message_update", true],
			["pi.message_end", false],
		]);
		expect(sent[0]?.data.stream).toBe("1");
		expect(sent[1]?.data.assistantMessageEvent).toEqual({
			type: "text_delta",
			contentIndex: 0,
			delta: "abc",
		});
		expect(sent[3]?.data).toMatchObject({ type: "message_end", stream: "1" });
	});

	test("a delta of another block sends what the first one held, in order", () => {
		const { sent, stream } = recorded();
		stream.messageStart(start());
		stream.messageUpdate(delta("a", 0));
		stream.messageUpdate(delta("x", 1, "thinking_delta"));
		stream.messageUpdate(delta("y", 1, "thinking_delta"));
		stream.messageEnd(end());
		expect(
			sent
				.filter((one) => one.type === "pi.message_update")
				.map((one) => one.data.assistantMessageEvent.delta),
		).toEqual(["a", "xy"]);
	});

	test("what the window holds goes out when the window ends", async () => {
		const { sent, stream } = recorded();
		stream.messageStart(start());
		stream.messageUpdate(delta("a"));
		await Bun.sleep(DELTA_WINDOW_MS + 20);
		expect(sent.map((one) => one.type)).toEqual(["pi.message_start", "pi.message_update"]);
	});

	test("goes out without pi's cumulative copies, and a tool call's start keeps its id and name", () => {
		const { sent, stream } = recorded();
		stream.messageStart(start());
		stream.messageUpdate(
			update({
				type: "toolcall_start",
				contentIndex: 0,
				partial: { content: [{ type: "toolCall", id: "call7", name: "bash" }] },
			}),
		);
		const [, wire] = sent;
		expect(wire?.data.message).toBeUndefined();
		expect(wire?.data.assistantMessageEvent).toEqual({
			type: "toolcall_start",
			contentIndex: 0,
			id: "call7",
			toolName: "bash",
		});
	});

	test("a user's message and a tool result never stream: they arrive as entries", () => {
		const { sent, stream } = recorded();
		stream.messageStart(start("user"));
		stream.messageEnd(end("user"));
		stream.messageStart(start("toolResult"));
		stream.messageEnd(end("toolResult"));
		expect(sent).toEqual([]);
	});

	test("a turn's end binds the turn's message to its entry, and a turn without one binds nothing", () => {
		const { sent, stream } = recorded();
		stream.messageStart(start());
		stream.messageEnd(end());
		stream.turnEnd(turnEnd("e9"));
		stream.turnEnd(turnEnd("e10"));
		stream.messageStart(start());
		stream.messageEnd(end());
		stream.turnEnd(turnEnd("e11"));
		expect(sent.filter((one) => one.type === "stream.bound").map((one) => one.data)).toEqual([
			{ messages: [{ stream: "1", entry: "e9" }] },
			{ messages: [{ stream: "2", entry: "e11" }] },
		]);
	});

	test("a resync sends the message as it stands, and nothing once it ended", () => {
		const { sent, stream } = recorded();
		stream.messageStart(start());
		stream.messageUpdate(update({ type: "text_start", contentIndex: 0 }, "Hel"));
		stream.resync();
		stream.messageEnd(end());
		stream.resync();
		const resyncs = sent.filter((one) => one.type === "stream.resync");
		expect(resyncs.map((one) => one.data)).toEqual([
			{ stream: "1", message: message("assistant", "Hel") },
		]);
	});
});

describe("a running tool", () => {
	test("goes out without its arguments, which the message's tool call holds", () => {
		const { sent, stream } = recorded();
		stream.toolStart(toolStart());
		expect(sent[0]?.data).toEqual({
			type: "tool_execution_start",
			toolCallId: "call1",
			toolName: "bash",
		});
	});

	test("sends its output at most every 100 ms, as the end of its text, and the last one held is not lost", async () => {
		const { sent, stream } = recorded();
		stream.toolStart(toolStart());
		stream.toolUpdate(toolUpdate("one"));
		stream.toolUpdate(toolUpdate("two"));
		stream.toolUpdate(toolUpdate("three"));
		expect(sent.filter((one) => one.type === "pi.tool_execution_update")).toHaveLength(1);
		await Bun.sleep(OUTPUT_EVERY_MS + 30);
		const updates = sent.filter((one) => one.type === "pi.tool_execution_update");
		expect(updates.map((one) => [one.data.output.text, one.droppable])).toEqual([
			["one", true],
			["three", true],
		]);
		expect(updates[0]?.data.details).toBeUndefined();
		stream.toolEnd(toolEnd("all of it"));
		expect(sent.at(-1)?.data).toEqual({
			type: "tool_execution_end",
			toolCallId: "call1",
			toolName: "bash",
			isError: false,
			durationMs: 12,
			output: { text: "all of it", truncated: false },
		});
	});

	test("an update held when the tool ends never goes out after the end", async () => {
		const { sent, stream } = recorded();
		stream.toolStart(toolStart());
		stream.toolUpdate(toolUpdate("one"));
		stream.toolUpdate(toolUpdate("two"));
		stream.toolEnd(toolEnd("done"));
		await Bun.sleep(OUTPUT_EVERY_MS + 30);
		expect(sent.at(-1)?.type).toBe("pi.tool_execution_end");
	});

	test("past 4 KB its output keeps the end, and only text counts", () => {
		const long = outputTail({ content: [{ type: "text", text: `${"x".repeat(5_000)}END` }] });
		expect(long.truncated).toBe(true);
		expect(long.text).toHaveLength(OUTPUT_TAIL);
		expect(long.text.endsWith("END")).toBe(true);
		expect(
			outputTail({
				content: [
					{ type: "image", data: "aGk=" },
					{ type: "text", text: "ok" },
				],
			}),
		).toEqual({ text: "ok", truncated: false });
		expect(outputTail(undefined)).toEqual({ text: "", truncated: false });
	});
});

test("stopping drops what the timers held", async () => {
	const { sent, stream } = recorded();
	stream.messageStart(start());
	stream.messageUpdate(delta("a"));
	stream.toolStart(toolStart());
	stream.toolUpdate(toolUpdate("one"));
	stream.toolUpdate(toolUpdate("two"));
	const before = sent.length;
	stream.stop();
	await Bun.sleep(OUTPUT_EVERY_MS + 30);
	expect(sent).toHaveLength(before);
});

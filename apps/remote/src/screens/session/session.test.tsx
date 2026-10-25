// The Session screen drawn from a real recording: the rig's pi session and its harness log, read as
// a client holds them after the wire. These pin what the screen promises: the conversation in order,
// thinking folded, a long output folded, the tasks still open, the question waited on, read only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type ClientSession, sessionOf } from "@adeildo/pi-remote-client";
import { applyChange, emptySessionState, isStateChangeType } from "@adeildo/pi-remote-protocol";
import { openQuestions } from "@adeildo/pi-remote-protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { openTasksOf } from "./panel-data.ts";
import { aboutOf, LINE_CHARS, OUTPUT_LINES, titleOf, viewOf } from "./session-document.tsx";
import { SessionDocument } from "./session-document.tsx";

const RECORDING = join(
	import.meta.dir,
	"../../../../../packages/remote-protocol/test/fixtures/recording",
);

function lines(file: string): Record<string, unknown>[] {
	return readFileSync(join(RECORDING, file), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The recording as a client holds it: pi's entries and the harness's state changes, in the order written. */
function recorded(): ClientSession {
	const session = sessionOf({ machine: "server", session: "01a16b1b-a4b1-734c-81d9-0c534a12eac1" });
	session.entries = lines("session.jsonl").filter((entry) => entry.type !== "session") as never;
	session.state = lines("harness.jsonl").reduce(
		(state, change) =>
			isStateChangeType(change.type) ? applyChange(state, change.type, change.data) : state,
		emptySessionState(),
	);
	return session;
}

/**
 * The recording moved back with `/tree` before its last turns, so its last entry ends a short branch.
 * The first one, with the thought and the tool call, ends at the answer after the tool's output.
 */
function firstBranch(): ClientSession {
	const session = recorded();
	const entries = session.entries as unknown as { id: string; message?: { role: string } }[];
	const output = entries.findIndex((entry) => entry.message?.role === "toolResult");
	const answer = entries.slice(output).find((entry) => entry.message?.role === "assistant");
	session.leaf = answer?.id;
	return session;
}

const draw = (session: ClientSession): string =>
	renderToStaticMarkup(createElement(SessionDocument, { session }));

/** A session made by hand, for what the recording does not hold. */
function handmade(
	entries: unknown[],
	changes: { type: string; data: unknown }[] = [],
): ClientSession {
	const session = sessionOf({ machine: "box", session: "abcdef12" });
	session.entries = entries as never;
	session.state = changes.reduce(
		(state, change) =>
			isStateChangeType(change.type) ? applyChange(state, change.type, change.data) : state,
		emptySessionState(),
	);
	return session;
}

function message(id: string, parentId: string | null, role: string, content: unknown): unknown {
	return { id, parentId, type: "message", timestamp: "t", message: { role, content } };
}

function custom(id: string, parentId: string | null, display: boolean, text: string): unknown {
	const content = [{ type: "text", text }];
	return {
		id,
		parentId,
		type: "custom_message",
		timestamp: "t",
		customType: "pi-peers:message",
		content,
		display,
	};
}

describe("the recording", () => {
	test("is drawn along the branch it ended on, with the title the tasks gave it", () => {
		const session = recorded();
		const html = draw(session);
		expect(titleOf(session, undefined)).toBe("new-eac1");
		expect(html).toContain("Read the rig log</h1>");
		const you = html.indexOf("remote-you");
		const pi = html.indexOf("remote-pi");
		expect(you).toBeGreaterThan(-1);
		expect(pi).toBeGreaterThan(you);
		// The composer under this screen is what makes a session writable, so the line is gone.
		expect(html).not.toContain("Read only.");
	});

	test("folds the model's thinking into one line", () => {
		const html = draw(firstBranch());
		expect(html).toMatch(/<li class="remote-thinking"><details><summary>thinking · /);
	});

	test("names a call by its tool, and shows what it returned", () => {
		const html = draw(firstBranch());
		expect(html).toMatch(/<span class="remote-who">\w+<\/span> /);
		expect(html).toContain('class="remote-output"');
	});
});

describe("what the recording does not hold", () => {
	test("a long output shows its first lines and folds the rest", () => {
		const text = Array.from({ length: OUTPUT_LINES + 3 }, (_, at) => `line ${at}`).join("\n");
		const html = draw(handmade([message("a", null, "toolResult", [{ type: "text", text }])]));
		expect(html).toContain("line 0");
		expect(html).toContain("3 more lines");
		// The rest is in the fold, not lost.
		expect(html).toContain(`line ${OUTPUT_LINES + 2}`);
	});

	test("an output that ends with a newline has no empty line to fold", () => {
		const text = `${Array.from({ length: OUTPUT_LINES }, (_, at) => `line ${at}`).join("\n")}\n`;
		const html = draw(handmade([message("a", null, "toolResult", [{ type: "text", text }])]));
		expect(html).not.toContain("<details>");
		const longer = `${text}line ${OUTPUT_LINES}\n`;
		const folded = draw(
			handmade([message("a", null, "toolResult", [{ type: "text", text: longer }])]),
		);
		expect(folded).toContain("1 more line<");
	});

	test("a line too wide is cut, with the whole output in the fold", () => {
		const wide = "x".repeat(LINE_CHARS * 3);
		const html = draw(handmade([message("a", null, "toolResult", [{ type: "text", text: wide }])]));
		expect(html).toContain(`${"x".repeat(LINE_CHARS - 1)}…`);
		expect(html).toContain("the whole output");
		expect(html).toContain(wide);
	});

	test("a fold's summary holds only words, never a block", () => {
		const text = Array.from({ length: OUTPUT_LINES + 2 }, (_, at) => `line ${at}`).join("\n");
		const html = draw(handmade([message("a", null, "toolResult", [{ type: "text", text }])]));
		const summaries = html.match(/<summary>.*?<\/summary>/g) ?? [];
		expect(summaries).toEqual(["<summary>2 more lines</summary>"]);
	});

	test("a thought with no text is named by the word alone", () => {
		const html = draw(
			handmade([message("a", null, "assistant", [{ type: "thinking", thinking: "" }])]),
		);
		expect(html).toContain("<summary>thinking</summary>");
	});

	test("a message an extension shows in the chat shows, and one it keeps out does not", () => {
		const html = draw(
			handmade([
				custom("a", null, true, "From otter: look at #107"),
				custom("b", "a", false, "who is here"),
			]),
		);
		expect(html).toContain("pi-peers:message");
		expect(html).toContain("From otter: look at #107");
		expect(html).not.toContain("who is here");
	});

	test("a short output is not folded", () => {
		const html = draw(handmade([message("a", null, "toolResult", [{ type: "text", text: "ok" }])]));
		expect(html).not.toContain("<details>");
	});

	test("the tasks it lists are the ones going on and waiting, not those done", () => {
		// The list is React Native now, so what is worth asserting is what it chooses to draw.
		expect(
			openTasksOf({
				tasks: [
					{ id: "1", status: "doing", text: "ship it" },
					{ id: "2", status: "done", text: "written" },
					{ id: "3", status: "waiting", text: "waiting on the review" },
				],
			} as never).map((one) => one.line),
		).toEqual(["doing · ship it", "waiting · waiting on the review"]);
	});

	test("the question it waits on is the open one, and an answered one leaves the list", () => {
		// The question is React Native now: what matters is that the state chooses the open ones.
		const opened = {
			id: "q1",
			source: "ask_questions",
			questions: [
				{ header: "Key", question: "Which key opens it?", options: [{ label: "Enter" }] },
			],
		};
		expect(
			openQuestions(viewOf(handmade([], [{ type: "ask.opened", data: opened }])).state),
		).toHaveLength(1);
		expect(
			openQuestions(
				viewOf(
					handmade(
						[],
						[
							{ type: "ask.opened", data: opened },
							{ type: "ask.closed", data: { id: "q1", result: { answers: [] } } },
						],
					),
				).state,
			),
		).toHaveLength(0);
	});

	test("draws nothing of the conversation when the bridge says the branch is back at the root", () => {
		const session = handmade([message("a", null, "user", [{ type: "text", text: "hello" }])]);
		session.leaf = null;
		expect(draw(session)).not.toContain("hello");
	});

	test("draws what a session wrote as text, never as markup", () => {
		const html = draw(
			handmade([
				message("a", null, "user", [{ type: "text", text: "<script>x()</script>" }]),
				message("b", "a", "assistant", [{ type: "thinking", thinking: "<img src=x onerror=y>" }]),
			]),
		);
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
	});
});

describe("drawing again on every envelope", () => {
	test("works the transcript and the state changes out again only when the session moved", () => {
		const session = handmade([message("a", null, "user", [{ type: "text", text: "hi" }])]);
		const first = viewOf(session);
		expect(viewOf(session)).toBe(first);

		session.entries.push(message("b", "a", "assistant", [{ type: "text", text: "yes" }]) as never);
		const pushed = viewOf(session);
		expect(pushed).not.toBe(first);
		expect(pushed.items).toHaveLength(2);

		session.leaf = "a";
		const moved = viewOf(session);
		expect(moved).not.toBe(pushed);
		expect(moved.items).toHaveLength(1);

		session.state = applyChange(session.state, "mode.changed", { mode: "judge" });
		expect(viewOf(session).state.permissions.mode).toBe("judge");

		// A snapshot swaps the list for one of the same length.
		session.entries = [message("c", null, "user", [{ type: "text", text: "new" }])] as never;
		session.leaf = undefined;
		expect(viewOf(session).items[0]).toMatchObject({ entry: "c" });
	});

	test("every part the header joins is text, so no object can slip through the join", () => {
		// The `unknown[]` that used to hold these parts is what let the folded state through as
		// `[object Object]`: `join` coerces anything and the type said nothing.
		const session = handmade([]);
		// The status lives in the state now; the snapshot keeps the photograph, and the header reads
		// what changes during the session.
		session.state = { ...session.state, status: "working" };
		expect(aboutOf(session).every((part) => typeof part === "string")).toBe(true);
		expect(aboutOf(session)).toContain("working");
	});

	test("the header says the status in words, not the folded state as an object", () => {
		// The wire calls the folded state `state`, and this line read it: the header drew
		// `[object Object]` where "working" belongs, and no type caught it because the parts are joined.
		const session = handmade([]);
		session.state = { ...session.state, status: "working" };
		const html = draw(session);
		expect(html).toContain("working");
		expect(html).not.toContain("[object Object]");
	});

	test("what is already drawn keeps its place when more arrives", () => {
		// "The interface does not dance": a message that arrives appends below what the person is
		// reading. The index of every line held stays, and the block above them does not grow.
		const first = message("a", null, "user", "first");
		const second = message("b", "a", "assistant", "second");
		const later = [message("c", "b", "user", "third"), message("d", "c", "assistant", "fourth")];

		const before = draw(handmade([first, second]));
		const after = draw(handmade([first, second, ...later]));

		// The text of each line, not the tag: a `<li>` carries a class per kind, so the sequence of tags
		// can match while the content underneath changed.
		const lines = (html: string): string[] => html.match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];
		const held = lines(before);
		expect(held.length).toBeGreaterThan(0);
		// Every line that was on screen is still there, in the same order, at the same index.
		expect(lines(after).slice(0, held.length)).toEqual(held);

		// And the header above them is the same height: one line of title and one of what the session is.
		const headerOf = (html: string): string => html.slice(0, html.indexOf("<ol"));
		expect(headerOf(after)).toBe(headerOf(before));
	});

	test("a question is drawn once, by the panel, not again as the raw call", () => {
		// The transcript used to show the call and its arguments, while the panel above the composer
		// showed the question a person can answer: the same question twice, and the raw form is not it.
		const asked = handmade([
			message("a", null, "assistant", [
				{ type: "toolCall", name: "ask_questions", arguments: { questions: [] } },
			]),
		]);
		const html = draw(asked);
		expect(html).not.toContain("ask_questions");

		// Another tool is still the transcript's to show.
		const other = handmade([
			message("a", null, "assistant", [
				{ type: "toolCall", name: "bash", arguments: { command: "ls" } },
			]),
		]);
		expect(draw(other)).toContain("bash");
	});
});

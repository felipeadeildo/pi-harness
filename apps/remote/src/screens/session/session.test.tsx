// The Session screen drawn from a real recording: the rig's pi session and its harness log, read as
// a client holds them after the wire. These pin what the screen promises: the conversation in order,
// thinking folded, a long output folded, the tasks still open, the question waited on, read only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type ClientSession, sessionOf } from "@adeildo/pi-remote-client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OUTPUT_LINES, SessionScreen, titleOf } from "./session.tsx";

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

/** The recording as a client holds it: pi's entries and the harness's facts, in the order written. */
function recorded(): ClientSession {
	const session = sessionOf({ machine: "server", session: "01a16b1b-a4b1-734c-81d9-0c534a12eac1" });
	session.entries = lines("session.jsonl").filter((entry) => entry.type !== "session") as never;
	session.facts = lines("harness.jsonl").map((fact) => ({
		type: String(fact.type),
		data: fact.data,
	}));
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
	renderToStaticMarkup(createElement(SessionScreen, { session }));

/** A session made by hand, for what the recording does not hold. */
function handmade(
	entries: unknown[],
	facts: { type: string; data: unknown }[] = [],
): ClientSession {
	const session = sessionOf({ machine: "box", session: "abcdef12" });
	session.entries = entries as never;
	session.facts = facts;
	return session;
}

function message(id: string, parentId: string | null, role: string, content: unknown): unknown {
	return { id, parentId, type: "message", timestamp: "t", message: { role, content } };
}

function task(id: string, status: string, text: string): unknown {
	return { id, text, status, origin: "you", created: { at: 0 }, asks: [], updatedAt: 0 };
}

describe("the recording", () => {
	test("is drawn along the branch it ended on, with the title the tasks gave it", () => {
		const session = recorded();
		const html = draw(session);
		expect(titleOf(session, undefined)).toBe("new-eac1");
		expect(html).toContain("<h1>Read the rig log</h1>");
		const you = html.indexOf("remote-you");
		const pi = html.indexOf("remote-pi");
		expect(you).toBeGreaterThan(-1);
		expect(pi).toBeGreaterThan(you);
		expect(html).toContain("Read only.");
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

	test("a short output is not folded", () => {
		const html = draw(handmade([message("a", null, "toolResult", [{ type: "text", text: "ok" }])]));
		expect(html).not.toContain("<details>");
	});

	test("lists the tasks going on and waiting, not those done", () => {
		const state = {
			version: 1,
			tasks: [task("1", "doing", "Write the screen"), task("2", "done", "Read the plan")],
			decisions: [],
			nextTask: 3,
			nextDecision: 1,
			updatedAt: 0,
		};
		const html = draw(handmade([], [{ type: "tasks.changed", data: { state } }]));
		expect(html).toContain("doing · Write the screen");
		expect(html).not.toContain("Read the plan");
	});

	test("shows the question it waits on until it is answered", () => {
		const opened = {
			id: "q1",
			source: "ask_questions",
			questions: [
				{ header: "Key", question: "Which key opens it?", options: [{ label: "Enter" }] },
			],
		};
		const waiting = draw(handmade([], [{ type: "ask.opened", data: opened }]));
		expect(waiting).toContain("Waiting for an answer");
		expect(waiting).toContain("Which key opens it?");
		expect(waiting).toContain("<li>Enter</li>");
		const answered = draw(
			handmade(
				[],
				[
					{ type: "ask.opened", data: opened },
					{ type: "ask.closed", data: { id: "q1", result: { answers: [] } } },
				],
			),
		);
		expect(answered).not.toContain("Waiting for an answer");
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

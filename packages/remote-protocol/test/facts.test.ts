// The two shapes the daemon and the bridge disagreed on, pinned where the reducers read them: a
// stream is the number pi gives it, and a leaf may be null when a `/tree` move goes back to the root.
import { describe, expect, test } from "bun:test";

import { isFact } from "../src/facts.ts";
import { isQueuedMessage, isSnapshot } from "../src/snapshot.ts";

describe("a fact the daemon has to carry", () => {
	test("a bound stream is the number pi numbered it with", () => {
		expect(isFact("stream.bound", { messages: [{ stream: 3, entry: "e1" }] })).toBe(true);
	});

	test("a stream that is not a number is refused, not read as one", () => {
		expect(isFact("stream.bound", { messages: [{ stream: "3", entry: "e1" }] })).toBe(false);
		expect(isFact("stream.bound", { messages: [{ entry: "e1" }] })).toBe(false);
		expect(isFact("stream.bound", { messages: [{ stream: 3 }] })).toBe(false);
	});

	test("a leaf back at the root is a leaf change, not a broken fact", () => {
		expect(isFact("leaf.changed", { leaf: null })).toBe(true);
		expect(isFact("leaf.changed", { leaf: "e1" })).toBe(true);
	});

	test("a leaf of the wrong shape is still refused", () => {
		expect(isFact("leaf.changed", { leaf: 4 })).toBe(false);
		expect(isFact("leaf.changed", {})).toBe(false);
	});
});

describe("a session's status", () => {
	test("is one of pi's five words", () => {
		for (const state of ["working", "blocked", "done", "error", "idle"]) {
			expect(isFact("session.state", { state })).toBe(true);
		}
	});

	test("is never peers' running or idle from the log, nor any other word", () => {
		// The log's own `session.state` is peers' activity and never crosses; the wire's status is
		// pi's, and a word from the other side is refused rather than shown as a status.
		expect(isFact("session.status", { status: "running" })).toBe(false);
		expect(isFact("session.status", { status: "waiting" })).toBe(false);
		expect(isFact("session.status", {})).toBe(false);
		expect(isFact("session.status", { status: "blocked" })).toBe(true);
	});
});

describe("a letter waiting in the inbox", () => {
	const by = { kind: "client" as const, name: "phone", machine: "here" };
	const letter = { id: "l1", by, text: "hold on", want: "followUp" as const, when: 1 };

	test("the four reasons a letter waits are the ones the kit writes", () => {
		for (const why of ["asleep", "quiet", "full", "stopped"] as const) {
			expect(isQueuedMessage({ ...letter, why })).toBe(true);
		}
		expect(isQueuedMessage({ ...letter, why: "waiting" })).toBe(false);
	});

	test("a letter needs who wrote it, which is what puts a person's words first", () => {
		expect(isQueuedMessage(letter)).toBe(true);
		expect(isQueuedMessage({ ...letter, by: undefined })).toBe(false);
		expect(isQueuedMessage({ ...letter, by: { kind: "client", name: "phone" } })).toBe(false);
		expect(isQueuedMessage({ ...letter, want: "later" })).toBe(false);
		expect(isQueuedMessage({ ...letter, id: "" })).toBe(false);
		expect(isQueuedMessage({ ...letter, text: "" })).toBe(false);
		// `NaN` is a number, and a queue ordered by it is a queue that never orders.
		expect(isQueuedMessage({ ...letter, when: Number.NaN })).toBe(false);
	});
});

describe("a prompt that arrived from elsewhere", () => {
	test("names who sent it, since that is the whole fact", () => {
		expect(
			isFact("prompt.received", { by: { kind: "client", name: "phone", machine: "here" } }),
		).toBe(true);
		// A prompt of nobody says nothing: the writer is the reason the fact exists.
		expect(isFact("prompt.received", {})).toBe(false);
		expect(isFact("prompt.received", { by: { kind: "client" } })).toBe(false);
	});
});

describe("a snapshot without a queue, and one with an empty queue", () => {
	const base = { session: "s1", machine: "here", cwd: "/work", kind: "terminal" as const };

	test("both are a snapshot, and they stay different", () => {
		// The screen draws "no queue" and "an empty queue" differently, so the protocol keeps both.
		const without = { ...base };
		const empty = { ...base, queue: [] };
		expect(isSnapshot(without)).toBe(true);
		expect(isSnapshot(empty)).toBe(true);
		expect("queue" in without).toBe(false);
		expect("queue" in empty).toBe(true);
	});

	test("a queue with a letter that does not decode is not a snapshot", () => {
		const bad = { ...base, queue: [{ id: "l1", text: "hold on", when: 1 }] };
		expect(isSnapshot(bad)).toBe(false);
	});
});

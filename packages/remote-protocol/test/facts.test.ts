// The two shapes the daemon and the bridge disagreed on, pinned where the reducers read them: a
// stream is the number pi gives it, and a leaf may be null when a `/tree` move goes back to the root.
import { describe, expect, test } from "bun:test";

import { isFact } from "../src/facts.ts";
import { isQueued } from "../src/snapshot.ts";

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
		expect(isFact("session.state", { state: "running" })).toBe(false);
		expect(isFact("session.state", { state: "waiting" })).toBe(false);
		expect(isFact("session.state", {})).toBe(false);
	});
});

describe("a letter waiting in the inbox", () => {
	const by = { kind: "client" as const, name: "phone", machine: "here" };
	const letter = { id: "l1", by, text: "hold on", want: "followUp" as const, when: 1 };

	test("the four reasons a letter waits are the ones the kit writes", () => {
		for (const why of ["asleep", "quiet", "full", "stopped"] as const) {
			expect(isQueued({ ...letter, why })).toBe(true);
		}
		expect(isQueued({ ...letter, why: "waiting" })).toBe(false);
	});

	test("a letter needs who wrote it, which is what puts a person's words first", () => {
		expect(isQueued(letter)).toBe(true);
		expect(isQueued({ ...letter, by: undefined })).toBe(false);
		expect(isQueued({ ...letter, by: { kind: "client", name: "phone" } })).toBe(false);
		expect(isQueued({ ...letter, want: "later" })).toBe(false);
		expect(isQueued({ ...letter, id: "" })).toBe(false);
	});
});

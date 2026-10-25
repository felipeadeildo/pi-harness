// The two shapes the daemon and the bridge disagreed on, pinned where the reducers read them: a
// stream is the number pi gives it, and a leaf may be null when a `/tree` move goes back to the root.
import { describe, expect, test } from "bun:test";

import { CHANGES, type Entry, STATE_CHANGES, isStateChangeType } from "../src/reduce/entry.ts";
import { applyChange, emptySessionState } from "../src/reduce/state.ts";
import { isQueuedMessage, isSummary } from "../src/summary.ts";
import type { StateChangeMap, StateChangeType } from "../src/state-changes.ts";

describe("a fact the daemon has to carry", () => {
	test("a bound stream is the number pi numbered it with", () => {
		expect(CHANGES["stream.bound"].check({ messages: [{ stream: 3, entry: "e1" }] })).toBe(true);
	});

	test("a stream that is not a number is refused, not read as one", () => {
		expect(CHANGES["stream.bound"].check({ messages: [{ stream: "3", entry: "e1" }] })).toBe(false);
		expect(CHANGES["stream.bound"].check({ messages: [{ entry: "e1" }] })).toBe(false);
		expect(CHANGES["stream.bound"].check({ messages: [{ stream: 3 }] })).toBe(false);
	});

	test("a leaf back at the root is a leaf change, not a broken fact", () => {
		expect(CHANGES["leaf.changed"].check({ leaf: null })).toBe(true);
		expect(CHANGES["leaf.changed"].check({ leaf: "e1" })).toBe(true);
	});

	test("a leaf of the wrong shape is still refused", () => {
		expect(CHANGES["leaf.changed"].check({ leaf: 4 })).toBe(false);
		expect(CHANGES["leaf.changed"].check({})).toBe(false);
	});
});

describe("the table of entries", () => {
	test("a fact with no check and no apply does not compile", () => {
		// `CHANGES` is a mapped type over `StateChangeType`: a fact added to `StateChangeMap` without an entry fails
		// here. The directive is the test — if the map became partial, it would be unused and `tsc`
		// reports that instead of silence.
		// @ts-expect-error the object is missing every entry, which is the compile error this pins
		const incomplete: { [K in StateChangeType]: Entry<StateChangeMap[K]> } = {};
		expect(incomplete).toBeDefined();
	});

	test("every fact the protocol lists has an entry, and every entry a fact", () => {
		expect([...STATE_CHANGES].sort()).toEqual((Object.keys(CHANGES) as StateChangeType[]).sort());
	});
});

describe("a session's status", () => {
	test("is one of pi's five words", () => {
		for (const status of ["working", "blocked", "done", "error", "idle"]) {
			expect(CHANGES["session.status"].check({ status })).toBe(true);
		}
		// The log's own `session.state` is not a fact of this protocol, and never reads as one.
		expect(isStateChangeType("session.state")).toBe(false);
	});

	test("is never peers' running or idle from the log, nor any other word", () => {
		// The log's own `session.state` is peers' activity and never crosses; the wire's status is
		// pi's, and a word from the other side is refused rather than shown as a status.
		expect(CHANGES["session.status"].check({ status: "running" })).toBe(false);
		expect(CHANGES["session.status"].check({ status: "waiting" })).toBe(false);
		expect(CHANGES["session.status"].check({})).toBe(false);
		expect(CHANGES["session.status"].check({ status: "blocked" })).toBe(true);
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
			CHANGES["prompt.received"].check({ by: { kind: "client", name: "phone", machine: "here" } }),
		).toBe(true);
		// A prompt of nobody says nothing: the writer is the reason the fact exists.
		expect(CHANGES["prompt.received"].check({})).toBe(false);
		expect(CHANGES["prompt.received"].check({ by: { kind: "client" } })).toBe(false);
	});
});

describe("a snapshot without a queue, and one with an empty queue", () => {
	const base = { session: "s1", machine: "here", cwd: "/work", kind: "terminal" as const };

	test("both are a snapshot, and they stay different", () => {
		// The screen draws "no queue" and "an empty queue" differently, so the protocol keeps both.
		const without = { ...base };
		const empty = { ...base, queue: [] };
		expect(isSummary(without)).toBe(true);
		expect(isSummary(empty)).toBe(true);
		expect("queue" in without).toBe(false);
		expect("queue" in empty).toBe(true);
	});

	test("a queue with a letter that does not decode is not a snapshot", () => {
		const bad = { ...base, queue: [{ id: "l1", text: "hold on", when: 1 }] };
		expect(isSummary(bad)).toBe(false);
	});
});

describe("a change whose data does not fit", () => {
	test("leaves the state as it was, because the entry checks before it applies", () => {
		// `applyChange` does not check the type — the caller does, and its signature proves it. The data
		// is another matter: it comes off the wire, and the entry's `check` is the only thing between a
		// malformed payload and a state somebody draws.
		const before = emptySessionState();
		const after = applyChange(before, "mode.changed", { mode: "not a mode" });
		expect(after).toBe(before);
		const queued = applyChange(before, "queue.changed", { queue: "not a list" });
		expect(queued).toBe(before);
	});
});

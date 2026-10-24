// The acceptance table the room asked for: a list of logged events in, the final state out. It runs
// the same function the bridge, the daemon and the client run, so a line here is a promise all three
// keep. The queue is in it because a client that resumes must read the queue the session holds.
import { describe, expect, test } from "bun:test";

import { applyEvent, emptySessionState, type SessionState } from "../src/reduce/state.ts";

const at = (n: number) => ({ machine: "m", session: "s", epoch: "e", seq: n });
const tasks = { version: 1, tasks: [], decisions: [], nextTask: 1, nextDecision: 1, updatedAt: 1 };
const queued = (id: string) => ({
	id,
	by: { kind: "client", name: "phone", machine: "laptop" },
	text: `message ${id}`,
	want: "followUp",
	when: 1,
});

function folded(events: { type: string; data: unknown }[]): SessionState {
	return events.reduce((state, one) => applyEvent(state, one.type, one.data), emptySessionState());
}

describe("the state a list of events leaves", () => {
	test("nothing at all is an empty state, not a missing one", () => {
		expect(emptySessionState()).toEqual({ questions: {}, permissions: { rulings: {} }, queue: [] });
		expect(folded([])).toEqual(emptySessionState());
	});

	test("tasks, mode, a question and its answer", () => {
		const state = folded([
			{ type: "tasks.changed", data: { state: tasks } },
			{ type: "mode.changed", data: { mode: "edits" } },
			{ type: "ask.opened", data: { id: "q1", source: "agent", questions: [] } },
			{ type: "ask.closed", data: { id: "q1", by: { kind: "client", name: "phone" }, result: {} } },
		]);
		expect(state.tasks).toEqual(tasks as never);
		expect(state.permissions.mode).toBe("edits");
		expect(state.questions.q1).toMatchObject({ closed: true, by: { name: "phone" } });
	});

	test("the queue is the last list written, and clearing it leaves an empty one", () => {
		const state = folded([
			{ type: "queue.changed", data: { queue: [queued("a")] } },
			{ type: "queue.changed", data: { queue: [queued("a"), queued("b")] } },
		]);
		expect(state.queue.map((one) => one.id)).toEqual(["a", "b"]);
		expect(folded([{ type: "queue.changed", data: { queue: [] } }]).queue).toEqual([]);
	});

	test("an event this version cannot read leaves the state as it was", () => {
		const before = folded([{ type: "queue.changed", data: { queue: [queued("a")] } }]);
		const after = applyEvent(before, "queue.changed", { queue: "not a list" });
		expect(after).toBe(before);
	});

	test("the door and the epoch are not state: they are the stream's", () => {
		const before = emptySessionState();
		for (const type of ["leaf.changed", "stream.bound", "session.live", "session.gone"]) {
			expect(applyEvent(before, type, { leaf: null })).toBe(before);
		}
		// A fact that names where it was written still says nothing about the state.
		expect(
			applyEvent(before, "prompt.received", { by: { kind: "client", name: "phone" }, ...at(1) }),
		).toBe(before);
	});
});

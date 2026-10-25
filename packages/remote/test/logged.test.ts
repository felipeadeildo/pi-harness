import { describe, expect, test } from "bun:test";

import { KEPT_CLOSED } from "@adeildo/pi-remote-protocol";

import { forward, Harness } from "../src/bridge/logged.ts";

function ruled(toolCallId: string, head = "ok") {
	return { toolCallId, ruling: { head, tone: "success" } };
}

describe("what the bridge forwards from the log", () => {
	const line = (type: string, data: unknown, session = "s1") => ({ session, type, data });

	test("a fact of this session crosses, and is kept for the snapshot", () => {
		const facts = new Harness();
		const sent: { type: string; data: unknown }[] = [];
		forward(line("mode.changed", { mode: "edits" }), "s1", facts, (type, data) =>
			sent.push({ type, data }),
		);
		expect(sent).toEqual([{ type: "mode.changed", data: { mode: "edits" } }]);
		expect(facts.snapshot(undefined, undefined, false, undefined).permissions.mode).toBe("edits");
	});

	test("another session's event and a type nobody forwards stay where they are", () => {
		const facts = new Harness();
		const sent: unknown[] = [];
		const send = (type: string, data: unknown) => void sent.push({ type, data });
		// A shared room carries facts of other sessions, and `stream.bound` is the stream's business.
		forward(line("mode.changed", { mode: "full" }, "s2"), "s1", facts, send);
		forward(line("stream.bound", { messages: [] }), "s1", facts, send);
		expect(sent).toEqual([]);
	});
});

describe("the facts a snapshot carries", () => {
	test("a question stays open until it closes", () => {
		const facts = new Harness();
		facts.saw("ask.opened", { id: "q1", source: "agent", questions: [] });
		facts.saw("ask.opened", { id: "q2", source: "agent", questions: [] });
		facts.saw("ask.closed", { id: "q1", result: {} });
		expect(facts.openQuestions).toEqual(["q2"]);
	});

	test("rebuild the tasks, the mode, the open questions and each call's latest ruling, in that order", () => {
		const facts = new Harness();
		facts.saw("call.ruled", ruled("c1", "asked"));
		facts.saw("ask.opened", { id: "q1", source: "agent", questions: [] });
		facts.saw("call.ruled", ruled("c1", "allowed"));
		const tasks = {
			version: 1,
			tasks: [],
			decisions: [],
			nextTask: 1,
			nextDecision: 1,
			updatedAt: 1,
		};
		const state = facts.snapshot(tasks, "edits", false, undefined);
		expect(state.tasks?.version).toBe(1);
		expect(state.permissions.mode).toBe("edits");
		expect(Object.keys(state.questions)).toEqual(["q1"]);
		expect(state.permissions.rulings["c1"]).toEqual({
			ruling: { head: "allowed", tone: "success" },
		});
	});

	test("keep only the latest rulings, and a call ruled again counts as the newest", () => {
		const facts = new Harness();
		for (let at = 0; at <= KEPT_CLOSED; at += 1) facts.saw("call.ruled", ruled(`c${at}`));
		facts.saw("call.ruled", ruled("c1", "again"));
		facts.saw("call.ruled", ruled("late"));
		const calls = Object.keys(
			facts.snapshot(undefined, undefined, false, undefined).permissions.rulings,
		);
		expect(calls).toHaveLength(KEPT_CLOSED);
		expect(calls).not.toContain("c0");
		// One over the bound went in, and the call ruled again moved to the end, so the bound dropped
		// from the front of what was left: c0 with the first trim, c2 with the second.
		expect(calls[0]).toBe("c3");
		expect(calls.slice(-2)).toEqual(["c1", "late"]);
	});

	test("a fact that is not an object, or that names nothing, changes nothing", () => {
		const facts = new Harness();
		facts.saw("ask.opened", "q1");
		facts.saw("ask.opened", { questions: [] });
		facts.saw("call.ruled", { ruling: {} });
		expect(facts.snapshot(undefined, undefined, false, undefined)).toEqual({
			questions: {},
			permissions: { rulings: {}, serves: false },
			queue: [],
		});
	});
});

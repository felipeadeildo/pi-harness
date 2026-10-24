import { describe, expect, test } from "bun:test";

import { KEPT_CLOSED } from "@adeildo/pi-remote-protocol";

import { Harness } from "../src/bridge/harness.ts";

function ruled(toolCallId: string, head = "ok") {
	return { toolCallId, ruling: { head, tone: "success" } };
}

describe("the facts a snapshot carries", () => {
	test("a question stays open until it closes", () => {
		const facts = new Harness();
		facts.saw("ask.opened", { id: "q1", source: "agent", questions: [] });
		facts.saw("ask.opened", { id: "q2", source: "agent", questions: [] });
		facts.saw("ask.closed", { id: "q1", result: {} });
		expect(facts.openAsks).toEqual(["q2"]);
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
		const state = facts.snapshot(tasks, "edits");
		expect(state.tasks?.version).toBe(1);
		expect(state.mode).toBe("edits");
		expect(Object.keys(state.asks)).toEqual(["q1"]);
		expect(state.rulings["c1"]).toEqual({ ruling: { head: "allowed", tone: "success" } });
	});

	test("keep only the latest rulings, and a call ruled again counts as the newest", () => {
		const facts = new Harness();
		for (let at = 0; at <= KEPT_CLOSED; at += 1) facts.saw("call.ruled", ruled(`c${at}`));
		facts.saw("call.ruled", ruled("c1", "again"));
		facts.saw("call.ruled", ruled("late"));
		const calls = Object.keys(facts.snapshot(undefined, undefined).rulings);
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
		expect(facts.snapshot(undefined, undefined)).toEqual({ rulings: {}, asks: {} });
	});
});

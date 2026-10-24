import { describe, expect, test } from "bun:test";

import { HarnessFacts, SNAPSHOT_RULINGS } from "../src/bridge/facts.ts";

function ruled(toolCallId: string, head = "ok") {
	return { toolCallId, ruling: { head, tone: "success" } };
}

describe("the facts a snapshot carries", () => {
	test("a question stays open until it closes", () => {
		const facts = new HarnessFacts();
		facts.saw("ask.opened", { id: "q1", source: "agent", questions: [] });
		facts.saw("ask.opened", { id: "q2", source: "agent", questions: [] });
		facts.saw("ask.closed", { id: "q1", result: {} });
		expect(facts.openAsks).toEqual(["q2"]);
	});

	test("rebuild the tasks, the mode, the open questions and each call's latest ruling, in that order", () => {
		const facts = new HarnessFacts();
		facts.saw("call.ruled", ruled("c1", "asked"));
		facts.saw("ask.opened", { id: "q1", source: "agent", questions: [] });
		facts.saw("call.ruled", ruled("c1", "allowed"));
		const tasks = { version: 1, tasks: [], decisions: [] };
		expect(facts.snapshot(tasks, "edits")).toEqual([
			{ type: "tasks.changed", data: { state: tasks } },
			{ type: "mode.changed", data: { mode: "edits" } },
			{ type: "ask.opened", data: { id: "q1", source: "agent", questions: [] } },
			{ type: "call.ruled", data: ruled("c1", "allowed") },
		]);
		expect(facts.snapshot(undefined, undefined).map((fact) => fact.type)).toEqual([
			"ask.opened",
			"call.ruled",
		]);
	});

	test("keep only the latest rulings, and a call ruled again counts as the newest", () => {
		const facts = new HarnessFacts();
		for (let at = 0; at <= SNAPSHOT_RULINGS; at += 1) facts.saw("call.ruled", ruled(`c${at}`));
		facts.saw("call.ruled", ruled("c1", "again"));
		facts.saw("call.ruled", ruled("late"));
		const calls = facts
			.snapshot(undefined, undefined)
			.map((fact) => (fact.data as { toolCallId: string }).toolCallId);
		expect(calls).toHaveLength(SNAPSHOT_RULINGS);
		expect(calls).not.toContain("c0");
		expect(calls).not.toContain("c2");
		expect(calls.slice(-2)).toEqual(["c1", "late"]);
	});

	test("a fact that is not an object, or that names nothing, changes nothing", () => {
		const facts = new HarnessFacts();
		facts.saw("ask.opened", "q1");
		facts.saw("ask.opened", { questions: [] });
		facts.saw("call.ruled", { ruling: {} });
		expect(facts.snapshot(undefined, undefined)).toEqual([]);
	});
});

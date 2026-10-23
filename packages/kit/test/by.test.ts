import { describe, expect, test } from "bun:test";
import { hostname } from "node:os";

import { bySession, isBy } from "../src/contracts/by.ts";

function session(id: string, name?: string) {
	return { getSessionId: () => id, getSessionName: () => name };
}

describe("who caused a fact", () => {
	test("the terminal, a client and an agent are the three kinds", () => {
		for (const kind of ["terminal", "client", "agent"]) {
			expect(isBy({ kind, name: "otter", machine: "laptop" })).toBe(true);
		}
	});

	test("a session is named by its pi name, and by the end of its id while it has none", () => {
		expect(bySession("terminal", session("01a16a75-d3d6", "Fix the release"), "laptop")).toEqual({
			kind: "terminal",
			name: "Fix the release",
			machine: "laptop",
		});
		expect(bySession("agent", session("01a16a75-d3d6"), "laptop").name).toBe("new-d3d6");
	});

	test("the machine is this one unless the caller says otherwise", () => {
		const by = bySession("terminal", session("01a16a75-d3d6", "x"));
		expect(by.machine).toBe(hostname());
		expect(isBy(by)).toBe(true);
	});

	test("anything else is not a cause", () => {
		expect(isBy({ kind: "stop", name: "otter", machine: "laptop" })).toBe(false);
		expect(isBy({ kind: "client", name: "phone" })).toBe(false);
		expect(isBy({ kind: "agent", name: 7, machine: "laptop" })).toBe(false);
		expect(isBy("terminal")).toBe(false);
		expect(isBy(undefined)).toBe(false);
	});
});

import { describe, expect, test } from "bun:test";

import { isBy } from "../src/contracts/by.ts";

describe("who caused a fact", () => {
	test("the terminal, a client and an agent are the three kinds", () => {
		for (const kind of ["terminal", "client", "agent"]) {
			expect(isBy({ kind, name: "otter", machine: "laptop" })).toBe(true);
		}
	});

	test("anything else is not a cause", () => {
		expect(isBy({ kind: "stop", name: "otter", machine: "laptop" })).toBe(false);
		expect(isBy({ kind: "client", name: "phone" })).toBe(false);
		expect(isBy({ kind: "agent", name: 7, machine: "laptop" })).toBe(false);
		expect(isBy("terminal")).toBe(false);
		expect(isBy(undefined)).toBe(false);
	});
});

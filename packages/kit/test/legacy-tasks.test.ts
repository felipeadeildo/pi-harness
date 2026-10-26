import { describe, expect, test } from "bun:test";

import { tasksHandleOf, tasksUsageOf } from "../src/legacy-tasks.ts";

const custom = (customType: string, data: unknown) => ({ type: "custom", customType, data });
const usage = { input: 80, output: 10, cost: 0.001 };

describe("what an older session's tasks left in its file", () => {
	test("every kind of entry the tasks paid for counts, under both of the package's names", () => {
		for (const kind of ["pi-tasks:update", "pi-tasks:usage", "pi-goal:update", "pi-goal:usage"])
			expect(tasksUsageOf(custom(kind, { usage }))).toEqual(usage);
		expect(tasksUsageOf(custom("pi-board:op", { usage }))).toBeUndefined();
		expect(tasksUsageOf(custom("pi-tasks:usage", { usage: { input: 1 } }))).toBeUndefined();
	});

	test("the handle is the last one the tasks wrote, and none when they never wrote one", () => {
		const update = (handle?: string) =>
			custom("pi-tasks:update", { state: handle === undefined ? {} : { handle } });
		expect(tasksHandleOf([update("release"), update(), update("oauth")])).toBe("oauth");
		expect(tasksHandleOf([update("release"), update()])).toBe("release");
		expect(
			tasksHandleOf([custom("pi-tasks:usage", { state: { handle: "nope" } })]),
		).toBeUndefined();
		expect(tasksHandleOf([])).toBeUndefined();
	});
});

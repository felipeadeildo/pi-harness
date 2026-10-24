import { describe, expect, test } from "bun:test";

import { bySession, handleOf } from "../src/by-session.ts";
import { isBy } from "../src/contracts/by.ts";
import { NAMES } from "../src/contracts/names.ts";
import { TASKS } from "../src/contracts/tasks.ts";
import { HOST } from "../src/host.ts";
import { emptyTasks } from "../src/tasks/state.ts";
import { fakeScope } from "../src/testing.ts";

const SESSION = { getSessionId: () => "01a16a75-d3d6" };

/** A scope whose tasks feature gave the session this handle and title. */
function tasksScope(handle: string | undefined, title = "Fix the release workflow") {
	const scope = fakeScope();
	TASKS.provide(scope, () => ({
		state: { ...emptyTasks(), title, ...(handle === undefined ? {} : { handle }) },
	}));
	return scope;
}

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

describe("the handle of a session", () => {
	test("the drawn word wins over the tasks', and there is none without either", () => {
		const both = tasksScope("release");
		NAMES.provide(both, () => ({ handle: "kestrel" }));
		expect(handleOf(both)).toBe("kestrel");
		expect(handleOf(tasksScope("release"))).toBe("release");
		expect(handleOf(fakeScope())).toBeUndefined();
	});
});

describe("a session as the cause", () => {
	test("is named by the handle the room knows it by, never by its title", () => {
		expect(bySession("terminal", tasksScope("release"), SESSION, { machine: "laptop" })).toEqual({
			kind: "terminal",
			name: "release",
			machine: "laptop",
		});
	});

	test("is named by the handle the names feature drew, before the tasks'", () => {
		const scope = tasksScope("release");
		NAMES.provide(scope, () => ({ handle: "kestrel" }));
		expect(bySession("agent", scope, SESSION).name).toBe("kestrel");
	});

	test("is new- and the end of its id while it has no handle", () => {
		expect(bySession("agent", tasksScope(undefined), SESSION)).toEqual({
			kind: "agent",
			name: "new-d3d6",
			machine: HOST,
		});
		expect(bySession("agent", fakeScope(), SESSION).name).toBe("new-d3d6");
	});

	test("is never a client, which only its device can name", () => {
		// @ts-expect-error A session cannot name a phone.
		expect(bySession("client", tasksScope("release"), SESSION).kind).toBe("client");
	});

	test("happened on this machine unless the caller says otherwise", () => {
		const by = bySession("terminal", tasksScope("release"), SESSION);
		expect(by.machine).toBe(HOST);
		expect(isBy(by)).toBe(true);
	});
});

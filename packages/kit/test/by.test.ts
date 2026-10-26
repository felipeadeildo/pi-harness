import { describe, expect, test } from "bun:test";

import { bySession, handleOf } from "../src/by-session.ts";
import { isBy } from "../src/contracts/by.ts";
import { NAMES } from "../src/contracts/names.ts";
import { HOST } from "../src/host.ts";
import { fakeScope } from "../src/testing.ts";

const SESSION = { getSessionId: () => "01a16a75-d3d6" };

/** A scope whose names feature gave the session this handle. */
function named(handle: string | undefined) {
	const scope = fakeScope();
	if (handle !== undefined) NAMES.provide(scope, () => ({ handle }));
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
	test("is the word the names feature holds, and there is none without it", () => {
		expect(handleOf(named("kestrel"))).toBe("kestrel");
		expect(handleOf(fakeScope())).toBeUndefined();
	});
});

describe("a session as the cause", () => {
	test("is named by the handle the room knows it by", () => {
		expect(bySession("terminal", named("release"), SESSION, { machine: "laptop" })).toEqual({
			kind: "terminal",
			name: "release",
			machine: "laptop",
		});
	});

	test("is new- and the end of its id while it has no handle", () => {
		expect(bySession("agent", named(undefined), SESSION)).toEqual({
			kind: "agent",
			name: "new-d3d6",
			machine: HOST,
		});
		expect(bySession("agent", fakeScope(), SESSION).name).toBe("new-d3d6");
	});

	test("is never a client, which only its device can name", () => {
		// @ts-expect-error A session cannot name a phone.
		expect(bySession("client", named("release"), SESSION).kind).toBe("client");
	});

	test("happened on this machine unless the caller says otherwise", () => {
		const by = bySession("terminal", named("release"), SESSION);
		expect(by.machine).toBe(HOST);
		expect(isBy(by)).toBe(true);
	});
});

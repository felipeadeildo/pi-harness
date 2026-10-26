import { describe, expect, test } from "bun:test";

import { emptySessionState } from "@adeildo/pi-remote-protocol";

import { readEnvelope, sessionOf, type ClientSession } from "../../src/client/session.ts";

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const one of Object.values(value)) deepFreeze(one);
		Object.freeze(value);
	}
	return value;
}

const envelope = (type: string, data: unknown, seq: number) => ({
	v: 1,
	kind: "event",
	machine: "box",
	session: "s",
	epoch: "e1",
	type,
	seq,
	data,
	at: 0,
});

const started = (): ClientSession =>
	sessionOf(
		{ machine: "box", session: "s" },
		{
			key: { machine: "box", session: "s" },
			cursor: { epoch: "e1", seq: 1 },
			entries: [],
			state: emptySessionState(),
		},
	);

describe("reading never mutates the session it was given", () => {
	test("a frozen session stays readable, and every read returns a new one", () => {
		// A mutation here throws on the frozen object instead of silently changing what another reader
		// is drawing: this is the property the returned session exists for.
		const session = deepFreeze(started());
		const afterEntry = readEnvelope(
			session,
			envelope(
				"entry",
				{
					id: "a",
					parentId: null,
					type: "message",
					timestamp: "t",
					message: { role: "user", content: [] },
				},
				2,
			),
		);
		expect(afterEntry.read).toBe("now");
		if (afterEntry.read !== "now") return;
		expect(afterEntry.session).not.toBe(session);
		expect(afterEntry.session.entries).toHaveLength(1);
		expect(session.entries).toHaveLength(0);

		const afterChange = readEnvelope(
			afterEntry.session,
			envelope("mode.changed", { mode: "judge" }, 3),
		);
		if (afterChange.read !== "now") throw new Error("expected a read");
		expect(afterChange.session.state.permissions.mode).toBe("judge");
		// The session read from is untouched: a second reader still sees the state it had.
		expect(afterEntry.session.state.permissions.mode).toBeUndefined();
	});

	test("a skip or a request for the whole state leaves the object equal to a copy taken before", () => {
		const session = deepFreeze(started());
		const before = structuredClone(session);
		expect(readEnvelope(session, envelope("mode.changed", { mode: "nope" }, 1))).toEqual({
			read: "skip",
		});
		const gap = readEnvelope(session, envelope("leaf.changed", { leaf: "missing" }, 2));
		expect(gap).toEqual({ read: "state", why: "gap" });
		expect(session).toEqual(before);
	});

	test("an opening that does not carry the state keeps the one the client had", () => {
		// The snapshot may arrive without the folded state; replacing it with nothing would draw an
		// empty session beside a branch full of entries.
		const before = readEnvelope(started(), envelope("mode.changed", { mode: "judge" }, 2));
		if (before.read !== "now") throw new Error("expected a read");
		const after = readEnvelope(
			before.session,
			envelope(
				"state",
				{
					summary: { session: "s", machine: "box", cwd: "/work", kind: "terminal" },
					entries: [],
				},
				1,
			),
		);
		if (after.read !== "now") throw new Error("expected a read");
		expect(after.session.state.permissions.mode).toBe("judge");
	});
});

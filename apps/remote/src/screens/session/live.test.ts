import { describe, expect, test } from "bun:test";

import { readEnvelope, sessionOf, type SnapshotData } from "@adeildo/pi-remote-client";
import { applyChange, emptySessionState, type Envelope } from "@adeildo/pi-remote-protocol";

import { modeChoices } from "./composer-data.ts";
import { composerOf, liveOf, runningOf } from "./live.ts";

describe("what the pickers start on", () => {
	test("the live state wins over the photograph the snapshot took", () => {
		// The bug: the pickers were controlled by `snapshot.mode`, so a `mode.set` changed the state and
		// React put the photographed value back on the next render.
		const session = sessionOf({ machine: "box", session: "abcdef12" });
		session.snapshot = { mode: "manual", model: undefined } as never;
		session.state = applyChange(session.state, "mode.changed", { mode: "edits" });
		session.state = applyChange(session.state, "session.live", {
			model: { provider: "rig", id: "scripted" },
			thinkingLevel: "high",
		});

		expect(liveOf(session)).toEqual({
			mode: "edits",
			model: { provider: "rig", id: "scripted" },
			thinking: "high",
		});
	});

	test("nothing said is nothing shown, instead of a value the snapshot happened to carry", () => {
		const session = sessionOf({ machine: "box", session: "abcdef12" });
		session.snapshot = { mode: "judge" } as never;
		expect(liveOf(session)).toEqual({ mode: undefined, model: undefined, thinking: undefined });
	});

	test("the composer's props come from the state in one place, so a route cannot name the photograph", () => {
		// The route spreads this instead of naming `mode` by hand: naming it is how `snapshot?.mode`
		// got back into the select, and no test noticed because the screen still drew.
		const session = sessionOf({ machine: "box", session: "abcdef12" });
		session.snapshot = { mode: "manual" } as never;
		session.state = applyChange(session.state, "mode.changed", { mode: "edits" });
		const queued = {
			id: "q1",
			by: { kind: "client" as const, name: "phone", machine: "box" },
			text: "ship it",
			want: "idle" as never,
			when: 0,
		};
		session.state = { ...session.state, queue: [queued] };

		expect(composerOf(session)).toEqual({
			mode: "edits",
			model: undefined,
			thinking: undefined,
			waiting: [expect.objectContaining({ id: "q1" })],
			commands: undefined,
			serves: undefined,
			running: false,
			models: undefined,
			modelsTotal: undefined,
		});
	});
});

describe("when a run is going", () => {
	test("a session that works or waits on a person is running, and the rest are not", () => {
		for (const status of ["working", "blocked"] as const) expect(runningOf(status)).toBe(true);
		for (const status of ["idle", "done", "error", undefined] as const)
			expect(runningOf(status)).toBe(false);
	});
});

describe("what an opening says about the mode dial", () => {
	const key = { machine: "box", session: "abcdef12" };

	/** An opening as the bridge sends it, with the capability it computed. */
	function opened(serves: boolean) {
		const state = emptySessionState();
		const opening: SnapshotData = {
			summary: {
				session: key.session,
				machine: key.machine,
				cwd: "/work",
				kind: "terminal",
				state: { ...state, permissions: { ...state.permissions, serves } },
			},
			entries: [],
		};
		const envelope: Envelope = {
			v: 1,
			kind: "event",
			machine: key.machine,
			session: key.session,
			epoch: "e1",
			seq: 1,
			type: "state",
			data: opening,
			at: 0,
		};
		const read = readEnvelope(sessionOf(key), envelope);
		if (read.read !== "now") throw new Error(`the opening was not read: ${read.read}`);
		const { mode, serves: said } = composerOf(read.session);
		return modeChoices(mode, said);
	}

	test("a session that says it takes no mode offers no dial, and one that takes it offers every mode", () => {
		// `undefined` draws the dial too, so only `false` separates a client that read the opening from one
		// that did not: with the state ignored the capability stays `undefined` and this offers the dial.
		expect(opened(false)).toEqual([]);
		expect(opened(true).length).toBeGreaterThan(0);
	});
});

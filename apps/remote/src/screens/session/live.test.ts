import { describe, expect, test } from "bun:test";

import { sessionOf } from "@adeildo/pi-remote-client";
import { applyEvent } from "@adeildo/pi-remote-protocol";

import { composerOf, liveOf } from "./live.ts";

describe("what the pickers start on", () => {
	test("the live state wins over the photograph the snapshot took", () => {
		// The bug: the pickers were controlled by `snapshot.mode`, so a `mode.set` changed the state and
		// React put the photographed value back on the next render.
		const session = sessionOf({ machine: "box", session: "abcdef12" });
		session.snapshot = { mode: "manual", model: undefined } as never;
		session.state = applyEvent(session.state, "mode.changed", { mode: "edits" });
		session.state = applyEvent(session.state, "session.live", {
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
		session.state = applyEvent(session.state, "mode.changed", { mode: "edits" });
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
		});
	});
});

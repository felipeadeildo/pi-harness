import { describe, expect, test } from "bun:test";

import { sessionOf } from "@adeildo/pi-remote-client";
import { applyEvent } from "@adeildo/pi-remote-protocol";

import { liveOf } from "./live.ts";

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
});

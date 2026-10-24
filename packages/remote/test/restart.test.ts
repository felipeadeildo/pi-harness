import { describe, expect, test } from "bun:test";

import {
	applyLogged,
	emptyHarnessState,
	envelope,
	type HarnessState,
} from "@adeildo/pi-remote-protocol";

import { Sessions } from "../src/daemon/sessions.ts";

const around = (seq: number) => ({ machine: "m", session: "s", epoch: "e", seq });
const live = { pid: 1, startedAt: 1, cwd: "/x", kind: "terminal" as const };
const tasks = {
	version: 1 as const,
	tasks: [],
	decisions: [],
	nextTask: 1,
	nextDecision: 1,
	updatedAt: 1,
};

/** A daemon that just started, hearing from a bridge that never went away. */
function restarted(): Sessions {
	const sessions = new Sessions();
	sessions.live(envelope("event", "session.live", live, around(0)), live);
	return sessions;
}

/** The state a session has, as the daemon would hand it to a client that opens it now. */
function opening(sessions: Sessions): HarnessState | undefined {
	const first = sessions.opening("s")?.[0];
	if (first === undefined) return undefined;
	const data = first.data as { snapshot: { harness?: HarnessState } };
	return data.snapshot.harness;
}

describe("a daemon that restarts", () => {
	test("seeds itself with the state the bridge's snapshot carries", () => {
		const sessions = restarted();
		const harness: HarnessState = {
			...emptyHarnessState(),
			mode: "edits",
			tasks,
			asks: { q1: { id: "q1", source: "agent", questions: [] } },
		};
		sessions.event(
			envelope(
				"event",
				"snapshot",
				{
					snapshot: { session: "s", machine: "m", cwd: "/x", kind: "terminal", harness },
					entries: [],
				},
				around(1),
			),
		);
		// Nothing was replayed and the log was not read: one event carried the whole session.
		expect(sessions.get("s")?.facts).toEqual(harness);
		const state = opening(sessions);
		expect(state?.mode).toBe("edits");
		expect(state?.tasks).toEqual(tasks);
		expect(Object.keys(state?.asks ?? {})).toEqual(["q1"]);
	});

	test("folds what comes after the snapshot on top of it", () => {
		const sessions = restarted();
		sessions.event(
			envelope(
				"event",
				"snapshot",
				{
					snapshot: {
						session: "s",
						machine: "m",
						cwd: "/x",
						kind: "terminal",
						harness: { ...emptyHarnessState(), mode: "edits" },
					},
					entries: [],
				},
				around(1),
			),
		);
		sessions.event(envelope("event", "mode.changed", { mode: "judge" }, around(2)));
		const state = sessions.get("s")?.facts;
		expect(state?.mode).toBe("judge");
	});

	test("an event with a shape this version cannot read leaves the state as it was", () => {
		const sessions = restarted();
		sessions.event(envelope("event", "mode.changed", { mode: "edits" }, around(1)));
		sessions.event(envelope("event", "mode.changed", { mode: "not a mode" }, around(2)));
		expect(sessions.get("s")?.facts.mode).toBe("edits");
		expect(
			applyLogged(sessions.get("s")?.facts ?? emptyHarnessState(), "mode.changed", { mode: "full" })
				.mode,
		).toBe("full");
	});
});

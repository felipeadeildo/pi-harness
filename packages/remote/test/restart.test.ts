import { describe, expect, test } from "bun:test";

import {
	applyChange,
	emptySessionState,
	envelope,
	type SessionState,
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
function opening(sessions: Sessions): SessionState | undefined {
	const first = sessions.opening("s")?.[0];
	if (first === undefined) return undefined;
	const data = first.data as { summary: { state?: SessionState } };
	return data.summary.state;
}

describe("a daemon that restarts", () => {
	test("seeds itself with the state the bridge's snapshot carries", () => {
		const sessions = restarted();
		const folded: SessionState = {
			...emptySessionState(),
			tasks,
			questions: { q1: { id: "q1", source: "agent", questions: [] } },
			permissions: { mode: "edits", rulings: {} },
		};
		sessions.event(
			envelope(
				"event",
				"state",
				{
					summary: { session: "s", machine: "m", cwd: "/x", kind: "terminal", state: folded },
					entries: [],
				},
				around(1),
			),
		);
		// Nothing was replayed and the log was not read: one event carried the whole session.
		expect(sessions.get("s")?.state).toEqual(folded);
		const state = opening(sessions);
		expect(state?.permissions.mode).toBe("edits");
		expect(state?.tasks).toEqual(tasks);
		expect(Object.keys(state?.questions ?? {})).toEqual(["q1"]);
	});

	test("the opening a restarted daemon serves says which capabilities the session has", () => {
		const sessions = restarted();
		sessions.event(
			envelope(
				"event",
				"state",
				{
					summary: {
						session: "s",
						machine: "m",
						cwd: "/x",
						kind: "terminal",
						state: {
							...emptySessionState(),
							permissions: { rulings: {}, serves: true },
						},
					},
					entries: [],
				},
				around(1),
			),
		);
		expect(opening(sessions)?.permissions.serves).toBe(true);
	});

	test("a session no bridge answered for says nothing about its capabilities", () => {
		expect(emptySessionState().permissions.serves).toBeUndefined();
	});

	test("the opening of a restarted daemon carries the question answered before it", () => {
		const sessions = restarted();
		const answered = {
			...emptySessionState(),
			questions: { q1: { id: "q1", source: "agent", questions: [], closed: true } },
		};
		sessions.event(
			envelope(
				"event",
				"state",
				{
					summary: { session: "s", machine: "m", cwd: "/x", kind: "terminal", state: answered },
					entries: [],
				},
				around(1),
			),
		);
		const opening = sessions.opening("s") ?? [];
		// The window is the opening plus what came after it, and it is not empty: an `after` with nothing
		// in it would say the same about a session that never had a question.
		expect(opening.map((one) => one.type)).toEqual(["state"]);
		const state = (opening[0]?.data as { summary: { state?: SessionState } } | undefined)?.summary
			.state;
		expect(state?.questions.q1?.closed).toBe(true);
		// Nothing after the opening says the question opened again, which is what a bridge reposting it
		// on a reconnect would do.
		expect(opening.slice(1).map((one) => one.type)).not.toContain("ask.opened");
	});

	test("a snapshot without a state keeps the one the session already had", () => {
		const sessions = restarted();
		const folded: SessionState = {
			...emptySessionState(),
			questions: { q1: { id: "q1", source: "agent", questions: [] } },
		};
		const snapshot = (state: SessionState | undefined) =>
			sessions.event(
				envelope(
					"event",
					"state",
					{
						summary: {
							session: "s",
							machine: "m",
							cwd: "/x",
							kind: "terminal",
							...(state === undefined ? {} : { state }),
						},
						entries: [],
					},
					around(1),
				),
			);
		snapshot(folded);
		// A bridge that does not know the session sends a snapshot without a state, and absence means
		// unchanged: the fold the daemon already has stands.
		snapshot(undefined);
		expect(opening(sessions)?.questions).toEqual(folded.questions);
	});

	test("folds what comes after the snapshot on top of it", () => {
		const sessions = restarted();
		sessions.event(
			envelope(
				"event",
				"state",
				{
					summary: {
						session: "s",
						machine: "m",
						cwd: "/x",
						kind: "terminal",
						state: { ...emptySessionState(), permissions: { mode: "edits", rulings: {} } },
					},
					entries: [],
				},
				around(1),
			),
		);
		sessions.event(envelope("event", "mode.changed", { mode: "judge" }, around(2)));
		const state = sessions.get("s")?.state;
		expect(state?.permissions.mode).toBe("judge");
	});

	test("an event with a shape this version cannot read leaves the state as it was", () => {
		const sessions = restarted();
		sessions.event(envelope("event", "mode.changed", { mode: "edits" }, around(1)));
		sessions.event(envelope("event", "mode.changed", { mode: "not a mode" }, around(2)));
		expect(sessions.get("s")?.state.permissions.mode).toBe("edits");
		expect(
			applyChange(sessions.get("s")?.state ?? emptySessionState(), "mode.changed", { mode: "full" })
				.permissions.mode,
		).toBe("full");
	});
});

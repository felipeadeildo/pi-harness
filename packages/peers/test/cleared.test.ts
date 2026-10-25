import { expect, test } from "bun:test";

import { createRig } from "@adeildo/pi-kit/rig";
import { AgentSession } from "@earendil-works/pi-coding-agent";

import { onQueueCleared } from "../src/cleared.ts";

test("pi emptying a session's queue is heard, with the session's id", () => {
	const heard: string[] = [];
	const stop = onQueueCleared((session) => heard.push(session));
	let emptied = 0;
	// A session with only the fields pi's own clearQueue and sessionId read.
	const session: AgentSession = Object.assign(Object.create(AgentSession.prototype), {
		sessionManager: { getSessionId: () => "s1" },
		_steeringMessages: ["yours"],
		_followUpMessages: [],
		agent: { clearAllQueues: () => emptied++ },
		_emitQueueUpdate: () => {},
	});
	const cleared = session.clearQueue();
	expect(cleared).toEqual({ steering: ["yours"], followUp: [] });
	expect(emptied).toBe(1);
	expect(heard).toEqual(["s1"]);

	stop();
	session.clearQueue();
	expect(heard).toEqual(["s1"]);
});

test("the method we wrap is the one the real pi runs, so the effect is ours too", async () => {
	// The fake above proves the wrapper; this proves the wrapper is on the path pi actually takes.
	// A pi that renames or stops calling `clearQueue` leaves the first test green and this one red,
	// which is the alarm the patch needs: pi says nothing to extensions when it empties the queue.
	const heard: string[] = [];
	const stop = onQueueCleared((session) => heard.push(session));
	const rig = await createRig();
	try {
		rig.session.clearQueue();
		expect(heard).toEqual([rig.session.sessionId]);
	} finally {
		stop();
		rig.dispose();
	}
});

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
	// Proves the wrapper sits on the path pi takes: a pi that stops calling `clearQueue` turns this red.
	const heard: string[] = [];
	const stop = onQueueCleared((session) => heard.push(session));
	const rig = await createRig();
	try {
		// What pi returned, and not only that we heard about it: a wrapper that swallows the call and
		// returns `undefined` would still reach our listener, and the message would be gone.
		expect(rig.session.clearQueue()).toEqual({ steering: [], followUp: [] });
		expect(heard).toEqual([rig.session.sessionId]);
	} finally {
		stop();
		rig.dispose();
	}
});

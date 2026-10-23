import { expect, test } from "bun:test";

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

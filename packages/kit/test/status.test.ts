import { afterEach, describe, expect, test } from "bun:test";

import { fauxAssistantMessage, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ASK, CANCEL } from "../src/contracts/ask.ts";
import { createRig, type Rig } from "../src/rig.ts";
import {
	followSessionStatus,
	SESSION_STATUS,
	type SessionStatus,
	StatusTracker,
} from "../src/status.ts";
import { fakeContext, fakePi } from "../src/testing.ts";

const QUIET = { events: createEventBus(), warn: () => {} };

describe("a session's status", () => {
	test("starts idle, works while a run goes, and is done when it settles", () => {
		const tracker = new StatusTracker();
		expect(tracker.status).toBe("idle");
		tracker.runStarted();
		expect(tracker.status).toBe("working");
		tracker.turnEnded("completed");
		tracker.settled(false);
		expect(tracker.status).toBe("done");
	});

	test("is error when the last turn failed, until the next run", () => {
		const tracker = new StatusTracker();
		tracker.runStarted();
		tracker.turnEnded("error");
		tracker.settled(false);
		expect(tracker.status).toBe("error");
		tracker.runStarted();
		expect(tracker.status).toBe("working");
		tracker.turnEnded("completed");
		tracker.settled(false);
		expect(tracker.status).toBe("done");
	});

	test("a turn that failed and then was retried and finished is done", () => {
		const tracker = new StatusTracker();
		tracker.runStarted();
		tracker.turnEnded("error");
		tracker.turnEnded("completed");
		tracker.settled(false);
		expect(tracker.status).toBe("done");
	});

	test("is idle after the operator stops the run", () => {
		const tracker = new StatusTracker();
		tracker.runStarted();
		tracker.turnEnded("aborted");
		tracker.settled(true);
		expect(tracker.status).toBe("idle");
	});

	test("is blocked while a dialog or a question waits, over working and over done", () => {
		const tracker = new StatusTracker();
		tracker.runStarted();
		tracker.prompt(true);
		expect(tracker.status).toBe("blocked");
		tracker.prompt(false);
		expect(tracker.status).toBe("working");
		tracker.settled(false);
		tracker.ask("q1", true);
		expect(tracker.status).toBe("blocked");
		tracker.ask("q1", false);
		expect(tracker.status).toBe("done");
	});

	test("a dialog closed twice never leaves a negative count behind", () => {
		const tracker = new StatusTracker();
		tracker.prompt(false);
		tracker.prompt(true);
		expect(tracker.status).toBe("blocked");
	});

	test("works while compacting, then goes back to how the last run ended", () => {
		const tracker = new StatusTracker();
		tracker.runStarted();
		tracker.settled(false);
		tracker.compaction(true);
		expect(tracker.status).toBe("working");
		tracker.compaction(false);
		expect(tracker.status).toBe("done");
	});
});

/** A fake pi whose status is followed, with every change it announced. */
function followed() {
	const fake = fakePi();
	followSessionStatus(fake.pi);
	const changes: (SessionStatus | undefined)[] = [];
	SESSION_STATUS.onChanged({ events: fake.pi.events, warn: () => {} }, (value) =>
		changes.push(value),
	);
	const current = () => SESSION_STATUS.current({ events: fake.pi.events, warn: () => {} });
	return { fake, changes, current };
}

describe("following the session", () => {
	test("answers the status and announces each change once", async () => {
		const { fake, changes, current } = followed();
		const ctx = fakeContext();
		expect(current()).toBe("idle");
		await fake.fire("agent_start", { type: "agent_start" }, ctx);
		await fake.fire("ui_prompt_start", { type: "ui_prompt_start", kind: "select" }, ctx);
		await fake.fire("ui_prompt_end", { type: "ui_prompt_end", kind: "select" }, ctx);
		await fake.fire("turn_end", { type: "turn_end", outcome: "completed" }, ctx);
		await fake.fire("agent_settled", { type: "agent_settled", aborted: false }, ctx);
		expect(changes).toEqual(["working", "blocked", "working", "done"]);
		expect(current()).toBe("done");
	});

	test("a question the harness asks blocks until its asker closes it", () => {
		const { fake, changes } = followed();
		fake.pi.events.emit(ASK, { id: "q1", questions: [] });
		fake.pi.events.emit(CANCEL, { id: "q1", reason: "answered" });
		expect(changes).toEqual(["blocked", "idle"]);
	});

	test("a second follower in the same process leaves the first one answering", async () => {
		const { fake, changes } = followed();
		followSessionStatus(fake.pi);
		await fake.fire("agent_start", { type: "agent_start" }, fakeContext());
		expect(changes).toEqual(["working"]);
	});

	test("a status that does not decode is not an answer", () => {
		SESSION_STATUS.provide(QUIET, () => "napping" as SessionStatus);
		expect(SESSION_STATUS.current(QUIET)).toBeUndefined();
	});
});

describe("a real pi session", () => {
	let rig: Rig | undefined;
	afterEach(() => {
		rig?.dispose();
		rig = undefined;
	});

	async function statusesOf(reply: ReturnType<typeof fauxAssistantMessage>) {
		const changes: (SessionStatus | undefined)[] = [];
		rig = await createRig({
			extensions: [
				(pi: ExtensionAPI) => {
					followSessionStatus(pi);
					SESSION_STATUS.onChanged({ events: pi.events, warn: () => {} }, (value) =>
						changes.push(value),
					);
				},
			],
			answer: () => reply,
		});
		await rig.prompt("go");
		return changes;
	}

	test("works through a run and is done when it settles", async () => {
		expect(await statusesOf(fauxAssistantMessage("Done."))).toEqual(["working", "done"]);
	});

	test("is blocked while a tool waits on a dialog, then works again", async () => {
		const changes: (SessionStatus | undefined)[] = [];
		rig = await createRig({
			extensions: [
				(pi: ExtensionAPI) => {
					followSessionStatus(pi);
					SESSION_STATUS.onChanged({ events: pi.events, warn: () => {} }, (value) =>
						changes.push(value),
					);
					pi.registerTool({
						name: "pick",
						label: "pick",
						description: "Asks the operator to pick",
						parameters: Type.Object({}),
						async execute(_id, _params, _signal, _update, ctx) {
							const picked = await ctx.ui.select("Pick one", ["a", "b"]);
							return { content: [{ type: "text", text: picked ?? "none" }], details: {} };
						},
					});
				},
			],
			replies: [fauxAssistantMessage(fauxToolCall("pick", {})), fauxAssistantMessage("Picked.")],
			says: { select: ["a"] },
		});
		await rig.prompt("pick something");
		expect(changes).toEqual(["working", "blocked", "working", "done"]);
	});

	test("ends in error when the model fails", async () => {
		const failed = fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: "invalid request: the scripted model refused",
		});
		expect((await statusesOf(failed)).at(-1)).toBe("error");
	});
});

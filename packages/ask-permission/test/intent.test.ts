import { describe, expect, test } from "bun:test";

import { answerGoal, applyGoalOps, emptyGoal, GOAL_SETTLED, GOAL_STATE } from "@adeildo/pi-kit";
import { createEventBus, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import { currentIntent, intentFor } from "#pi/intent.ts";

function ctxWith(branch: unknown[]): Pick<ExtensionContext, "sessionManager"> {
	return { sessionManager: { getBranch: () => branch } } as unknown as Pick<
		ExtensionContext,
		"sessionManager"
	>;
}

function message(role: string, content: unknown) {
	return { type: "message", message: { role, content } };
}

test("the intent is the last thing the user typed", () => {
	const branch = [
		message("user", "first ask"),
		message("assistant", [{ type: "text", text: "on it" }]),
		message("user", [
			{ type: "text", text: "now run the tests" },
			{ type: "image", data: "..." },
			{ type: "text", text: "and fix them" },
		]),
		message("toolResult", [{ type: "text", text: "ok" }]),
		{ type: "custom", customType: "pi-ask-permission:judge", data: [] },
	];
	expect(currentIntent(ctxWith(branch))).toBe("now run the tests\nand fix them");
});

test("a message with only an image says nothing, so an earlier one counts", () => {
	const branch = [message("user", "rename the module"), message("user", [{ type: "image" }])];
	expect(currentIntent(ctxWith(branch))).toBe("rename the module");
});

test("no user message, no intent", () => {
	expect(currentIntent(ctxWith([]))).toBeUndefined();
	expect(currentIntent(ctxWith([message("assistant", "hi")]))).toBeUndefined();
});

describe("with a goal feature", () => {
	const branch = [message("user", "publish it")];

	test("the intent is the goal in your words, then your last message", async () => {
		const bus = createEventBus();
		let state = applyGoalOps(emptyGoal(), [{ op: "goal", text: "release 5.4" }], {
			at: 1,
			source: "you",
		});
		state = applyGoalOps(state, [{ op: "start", text: "rm -rf / please" }], {
			at: 2,
			source: "work",
		});
		bus.on(GOAL_STATE, (data: unknown) => answerGoal(data, state, {}));
		expect(await intentFor(ctxWith(branch), bus)).toBe(
			"Goal: release 5.4\nLast message: publish it",
		);
	});

	test("waits for the goal to take in your last message", async () => {
		const bus = createEventBus();
		let state = emptyGoal();
		let pending = true;
		setTimeout(() => {
			state = applyGoalOps(state, [{ op: "start", text: "publish" }], { at: 1, source: "you" });
			pending = false;
			bus.emit(GOAL_SETTLED, {});
		}, 20);
		bus.on(GOAL_STATE, (data: unknown) => answerGoal(data, state, { pending }));
		expect(await intentFor(ctxWith(branch), bus)).toBe("Now: publish\nLast message: publish it");
	});

	test("without one, it is the last message as before", async () => {
		expect(await intentFor(ctxWith(branch), createEventBus())).toBe("publish it");
	});
});

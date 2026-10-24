import { expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { currentIntent, intentFor, recentIntents } from "#pi/intent.ts";

function ctxWith(branch: unknown[], name?: string): Pick<ExtensionContext, "sessionManager"> {
	return {
		sessionManager: { getBranch: () => branch, getSessionName: () => name },
	} as unknown as Pick<ExtensionContext, "sessionManager">;
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

test("the last three operator messages come newest first, image-only ones taking no slot", () => {
	const branch = [
		message("user", "first ask"),
		message("assistant", "on it"),
		message("user", [{ type: "image" }]),
		message("user", "second ask"),
		message("toolResult", "ok"),
		message("user", "third ask"),
		message("user", [{ type: "image" }]),
	];
	expect(recentIntents(ctxWith(branch))).toEqual(["third ask", "second ask", "first ask"]);
	expect(intentFor(ctxWith(branch, "release"))).toBe(
		"Session: release\nThe operator's last messages, newest first:\n  1. third ask\n  2. second ask\n  3. first ask",
	);
});

test("the name the operator gave comes with the last message", () => {
	const branch = [message("user", "publish it")];
	expect(intentFor(ctxWith(branch, "release 5.4"))).toBe(
		"Session: release 5.4\nLast message: publish it",
	);
});

test("a blank name is no name, and the last message goes alone", () => {
	const branch = [message("user", "publish it")];
	expect(intentFor(ctxWith(branch, "  "))).toBe("Last message: publish it");
	expect(intentFor(ctxWith(branch))).toBe("Last message: publish it");
});

test("no operator words and no name is no intent", () => {
	expect(intentFor(ctxWith([]))).toBeUndefined();
});

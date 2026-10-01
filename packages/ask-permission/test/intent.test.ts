import { expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { currentIntent } from "#pi/intent.ts";

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

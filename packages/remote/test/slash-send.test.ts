import { describe, expect, test } from "bun:test";

import { commandApi } from "../src/commands-api.ts";

/** Drives the real `commandApi`, so a `send` that stops deciding fails here. */
function apiWith(offered: { name: string; source: string; description?: string }[]) {
	const sent: { text: string; options?: Record<string, unknown> }[] = [];
	const compacts: (string | undefined)[] = [];
	const scope = {
		getCommands: () => offered,
		sendUserMessage: (text: string, options?: Record<string, unknown>) =>
			void sent.push({ text, options }),
		events: { emit: () => {} },
		warn: () => {},
	} as never;
	const ctx = {
		isIdle: () => true,
		compact: (options?: { customInstructions?: string }) =>
			void compacts.push(options?.customInstructions),
	} as never;
	return { api: commandApi(scope, ctx), sent, compacts };
}

const offered = [
	{ name: "review", source: "prompt" },
	{ name: "deploy", source: "extension" },
];

describe("the send decides before pi sees the text", () => {
	test("a command the session offers goes out expanded", () => {
		const { api, sent } = apiWith(offered);
		api.send("/review", undefined);
		expect(sent).toEqual([{ text: "/review", options: { expandPromptTemplates: true } }]);
	});

	test("a command the session does not offer is refused, not sent as words", () => {
		const { api, sent } = apiWith(offered);
		expect(() => api.send("/deploy", undefined)).toThrow(/not a command this session offers/);
		expect(() => api.send("/nope", undefined)).toThrow(/not a command this session offers/);
		expect(sent).toEqual([]);
	});

	test("compact goes to the same effect the session command uses, with the instruction", () => {
		const { api, sent, compacts } = apiWith(offered);
		api.send("/compact keep the tests", undefined);
		expect(compacts).toEqual(["keep the tests"]);
		expect(sent).toEqual([]);
	});

	test("a plain prompt is still a prompt", () => {
		const { api, sent } = apiWith(offered);
		api.send("ship it", "steer");
		// The other half of the decision: everything that is not a command goes out as it is, and the flag
		// that expands skills is not set — otherwise a change that always sets it would pass unnoticed.
		expect(sent).toEqual([{ text: "ship it", options: { deliverAs: "steer" } }]);
	});
});

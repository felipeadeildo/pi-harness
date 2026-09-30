import { describe, expect, test } from "bun:test";

import { billingAttribution, CLAUDE_CODE_IDENTITY } from "../src/subscription/billing.ts";
import { billToPlan } from "../src/subscription/payload.ts";

const HOUR = { type: "ephemeral", ttl: "1h" };
const PROMPT = "You are pi. Follow AGENTS.md.";
const QUESTION = "Reply with the single word: pong";

function oauthPayload(messages: unknown[] = [{ role: "user", content: QUESTION }]) {
	return {
		model: "claude-opus-5-5",
		max_tokens: 1024,
		system: [
			{ type: "text", text: CLAUDE_CODE_IDENTITY, cache_control: HOUR },
			{ type: "text", text: PROMPT, cache_control: HOUR },
		],
		messages,
	};
}

const attribution = { type: "text", text: billingAttribution(QUESTION, "2.1.280") };
const instructions = {
	type: "text",
	text: `<system-instructions>\n${PROMPT}\n</system-instructions>`,
	cache_control: HOUR,
};

describe("an OAuth request", () => {
	test("keeps only the attribution and the identity in system", () => {
		const result = billToPlan(oauthPayload(), "2.1.280");
		expect(result?.system).toEqual([
			attribution,
			{ type: "text", text: CLAUDE_CODE_IDENTITY, cache_control: HOUR },
		]);
	});

	test("moves pi's prompt to the start of the first user message, keeping its cache breakpoint", () => {
		const result = billToPlan(oauthPayload(), "2.1.280");
		expect(result?.messages).toEqual([
			{ role: "user", content: [instructions, { type: "text", text: QUESTION }] },
		]);
	});

	test("keeps every other field of the request", () => {
		const result = billToPlan(oauthPayload(), "2.1.280");
		expect(result?.model).toBe("claude-opus-5-5");
		expect(result?.max_tokens).toBe(1024);
	});

	test("prepends to block content and leaves later messages alone", () => {
		const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "" } };
		const later = { role: "user", content: "and now?" };
		const result = billToPlan(
			oauthPayload([
				{ role: "user", content: [image, { type: "text", text: QUESTION }] },
				{ role: "assistant", content: "pong" },
				later,
			]),
			"2.1.280",
		);
		expect(result?.messages).toEqual([
			{ role: "user", content: [instructions, image, { type: "text", text: QUESTION }] },
			{ role: "assistant", content: "pong" },
			later,
		]);
		expect(result?.system).toContainEqual(attribution);
	});

	test("opens a user message when there is none", () => {
		const result = billToPlan(oauthPayload([]), "2.1.280");
		expect(result?.messages).toEqual([{ role: "user", content: [instructions] }]);
	});

	test("joins every system block after the identity, not only the second", () => {
		const payload = oauthPayload();
		payload.system.push({ type: "text", text: "Extra rules.", cache_control: HOUR });
		const result = billToPlan(payload, "2.1.280");
		expect(result?.messages).toEqual([
			{
				role: "user",
				content: [
					{
						...instructions,
						text: `<system-instructions>\n${PROMPT}\n\nExtra rules.\n</system-instructions>`,
					},
					{ type: "text", text: QUESTION },
				],
			},
		]);
	});

	test("with only the identity, adds the attribution and touches no message", () => {
		const payload = { ...oauthPayload(), system: [{ type: "text", text: CLAUDE_CODE_IDENTITY }] };
		const result = billToPlan(payload, "2.1.280");
		expect(result?.system).toEqual([attribution, { type: "text", text: CLAUDE_CODE_IDENTITY }]);
		expect(result?.messages).toEqual(payload.messages);
	});

	test("does not mutate the payload pi handed over", () => {
		const payload = oauthPayload();
		const before = structuredClone(payload);
		billToPlan(payload, "2.1.280");
		expect(payload).toEqual(before);
	});
});

describe("anything else", () => {
	test("a system prompt that does not open with Claude Code's identity is left alone", () => {
		expect(
			billToPlan({ system: [{ type: "text", text: PROMPT }], messages: [] }, "2.1.280"),
		).toBeUndefined();
	});

	test("a request that was already rewritten is left alone", () => {
		const once = billToPlan(oauthPayload(), "2.1.280");
		expect(once === undefined ? undefined : billToPlan(once, "2.1.280")).toBeUndefined();
	});

	test("a string system or a block that is not text is left alone", () => {
		expect(billToPlan({ system: CLAUDE_CODE_IDENTITY }, "2.1.280")).toBeUndefined();
		expect(
			billToPlan(
				{ system: [{ type: "text", text: CLAUDE_CODE_IDENTITY }, { type: "image" }] },
				"2.1.280",
			),
		).toBeUndefined();
	});
});

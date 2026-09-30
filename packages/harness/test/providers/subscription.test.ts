import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { type FakePi, fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { CLAUDE_CODE_IDENTITY } from "../../src/providers/subscription/billing.ts";
import { subscription } from "../../src/providers/subscription/feature.ts";

let dir: string;
let settingsPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-providers-"));
	settingsPath = join(dir, "settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function context(api: string, oauth: boolean): ExtensionContext {
	return fakeContext([], false, {
		model: { provider: "anthropic-work", api, id: "claude-opus-5-5" },
		modelRegistry: { isUsingOAuth: () => oauth },
	});
}

async function started(ctx: ExtensionContext): Promise<FakePi> {
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath }).use(subscription).build();
	await fake.fire("session_start", {}, ctx);
	return fake;
}

async function headersFor(api: string, oauth: boolean): Promise<Record<string, string | null>> {
	const ctx = context(api, oauth);
	const { fire } = await started(ctx);
	const event = { type: "before_provider_headers", headers: {} };
	await fire("before_provider_headers", event, ctx);
	return event.headers;
}

test("an OAuth account on any Anthropic provider gets Claude Code's user agent", async () => {
	expect(await headersFor("anthropic-messages", true)).toEqual({
		"user-agent": "claude-cli/2.1.280 (external, cli)",
	});
});

test("an API key or another API is left alone", async () => {
	expect(await headersFor("anthropic-messages", false)).toEqual({});
	expect(await headersFor("openai-responses", true)).toEqual({});
});

test("the version comes from the settings file", async () => {
	writeFileSync(settingsPath, JSON.stringify({ subscription: { claudeCodeVersion: "2.1.300" } }));
	expect(await headersFor("anthropic-messages", true)).toEqual({
		"user-agent": "claude-cli/2.1.300 (external, cli)",
	});
});

test("an OAuth request comes back with the attribution in system", async () => {
	const ctx = context("anthropic-messages", true);
	const { fire } = await started(ctx);
	const payload = {
		system: [
			{ type: "text", text: CLAUDE_CODE_IDENTITY },
			{ type: "text", text: "pi's prompt" },
		],
		messages: [{ role: "user", content: "hello there, pi" }],
	};

	const [result] = await fire(
		"before_provider_request",
		{ type: "before_provider_request", payload },
		ctx,
	);
	expect(result).toMatchObject({
		system: [
			{ text: expect.stringContaining("cc_version=2.1.280.") },
			{ text: CLAUDE_CODE_IDENTITY },
		],
	});
});

test("a request on an API key goes out as pi built it", async () => {
	const ctx = context("anthropic-messages", false);
	const { fire } = await started(ctx);
	const payload = { system: [{ type: "text", text: CLAUDE_CODE_IDENTITY }], messages: [] };
	expect(await fire("before_provider_request", { payload }, ctx)).toEqual([undefined]);
});

import { expect, test } from "bun:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { loginFor } from "../src/accounts/interaction.ts";

interface Ui {
	select?: (title: string, options: string[]) => Promise<string | undefined>;
	input?: (title: string) => Promise<string | undefined>;
	notified: string[];
	statuses: (string | undefined)[];
}

function context(ui: Ui): ExtensionContext {
	return {
		ui: {
			select: ui.select ?? (async () => undefined),
			input: ui.input ?? (async () => undefined),
			notify: (message: string) => void ui.notified.push(message),
			setStatus: (_key: string, text: string | undefined) => void ui.statuses.push(text),
		},
	} as unknown as ExtensionContext;
}

test("a select prompt answers with the option id, not its label", async () => {
	const ui: Ui = { select: async (_title, options) => options[1], notified: [], statuses: [] };
	const session = await loginFor(context(ui), "anthropic", new AbortController().signal);

	const answer = await session.interaction.prompt({
		type: "select",
		message: "Which method?",
		options: [
			{ id: "oauth", label: "Claude Pro/Max" },
			{ id: "api_key", label: "API key" },
		],
	});

	expect(answer).toBe("api_key");
});

test("a text prompt answers with what was typed", async () => {
	const ui: Ui = { input: async () => "sk-ant-123", notified: [], statuses: [] };
	const session = await loginFor(context(ui), "anthropic", new AbortController().signal);

	expect(await session.interaction.prompt({ type: "secret", message: "Paste the key" })).toBe(
		"sk-ant-123",
	);
});

test("a cancelled prompt rejects, so the login stops", async () => {
	const ui: Ui = { notified: [], statuses: [] };
	const session = await loginFor(context(ui), "anthropic", new AbortController().signal);

	await expect(session.interaction.prompt({ type: "text", message: "Paste" })).rejects.toThrow(
		"cancelled",
	);
});

test("an info event becomes a notification, and progress a status", async () => {
	const ui: Ui = { notified: [], statuses: [] };
	const session = await loginFor(context(ui), "anthropic", new AbortController().signal);

	session.interaction.notify({
		type: "info",
		message: "Waiting",
		links: [{ url: "https://x.dev" }],
	});
	session.interaction.notify({
		type: "device_code",
		userCode: "ABCD",
		verificationUri: "https://x.dev/device",
	});
	session.interaction.notify({ type: "progress", message: "Exchanging the token" });

	expect(ui.notified[0]).toContain("https://x.dev");
	expect(ui.notified[1]).toContain("ABCD");
	expect(ui.statuses).toContain("Exchanging the token");
});

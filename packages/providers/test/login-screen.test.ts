import { expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { LoginView } from "../src/ui/login.ts";

const THEME = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;
const TUI = { requestRender: () => {} } as unknown as TUI;

function view(signal = new AbortController().signal): LoginView {
	return new LoginView(TUI, THEME, "anthropic", signal, () => {});
}

test("the screen shows the URL, the code and the question", async () => {
	const screen = view();
	const pending = screen.interaction().prompt({ type: "text", message: "Paste the code" });
	screen.interaction().notify({
		type: "auth_url",
		url: "https://claude.ai/oauth",
		instructions: "open this page",
	});

	const body = screen.render(72).join("\n");
	expect(body).toContain("Entrar · anthropic");
	expect(body).toContain("https://claude.ai/oauth");
	expect(body).toContain("open this page");
	expect(body).toContain("Paste the code");

	screen.finish();
	await expect(pending).rejects.toThrow("cancelled");
});

test("a device code takes over the screen with its own page", async () => {
	const screen = view();
	const pending = screen.interaction().prompt({ type: "text", message: "Waiting" });
	screen.interaction().notify({
		type: "device_code",
		userCode: "WRBQ-4XLN",
		verificationUri: "https://x.dev/device",
	});

	const body = screen.render(72).join("\n");
	expect(body).toContain("https://x.dev/device");
	expect(body).toContain("WRBQ-4XLN");
	for (const line of screen.render(72)) expect(line.length).toBeGreaterThan(0);

	screen.finish();
	await expect(pending).rejects.toThrow("cancelled");
});

test("a select prompt answers with the option id", async () => {
	const screen = view();
	const pending = screen.interaction().prompt({
		type: "select",
		message: "Which method?",
		options: [
			{ id: "oauth", label: "Claude Pro/Max" },
			{ id: "api_key", label: "API key" },
		],
	});

	screen.handleInput("\u001b[B");
	screen.handleInput("\r");

	expect(await pending).toBe("api_key");
});

test("a secret prompt answers with what was typed and masks it", async () => {
	const screen = view();
	const pending = screen.interaction().prompt({ type: "secret", message: "Paste the key" });

	for (const char of "abc") screen.handleInput(char);
	expect(screen.render(72).join("\n")).toContain("•••");
	screen.handleInput("\r");

	expect(await pending).toBe("abc");
});

test("an aborted login rejects the prompt it waits on", async () => {
	const controller = new AbortController();
	const screen = view(controller.signal);
	const pending = screen.interaction().prompt({ type: "text", message: "Paste the code" });

	controller.abort();

	await expect(pending).rejects.toThrow("cancelled");
});

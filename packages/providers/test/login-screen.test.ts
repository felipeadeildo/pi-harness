import { expect, test } from "bun:test";

import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { LoginView } from "../src/ui/login.ts";

const THEME = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;
const TUI = { requestRender: () => {} } as unknown as TUI;

/** Nothing leaves the test machine, so no browser opens and no clipboard is touched. */
const QUIET = { open: () => {}, copy: async () => {} };

function view(signal = new AbortController().signal): LoginView {
	return new LoginView(TUI, THEME, "anthropic", signal, () => {}, QUIET);
}

/** What the terminal draws, with the hyperlink sequences taken out. */
function visible(lines: string[]): string {
	return lines
		.join("\n")
		.split("\u001b]8;;")
		.map((part) => part.slice(part.indexOf("\u0007") + 1))
		.join("");
}

/** Only the text inside the frame, joined, so a wrapped URL reads as one string. */
function rowText(lines: string[]): string {
	return visible(
		lines.map((line) => line.replace(/^\u2502 /u, "").replace(/\s*\u2502$/u, "")),
	).replace(/\n/gu, "");
}

test("the screen shows the URL itself, with the instructions on their own line", async () => {
	const screen = view();
	const pending = screen.interaction().prompt({ type: "text", message: "Paste the code" });
	screen.interaction().notify({
		type: "auth_url",
		url: "https://claude.ai/oauth/authorize?code=true",
		instructions: "open this page",
	});

	const shown = visible(screen.render(72));
	expect(shown).toContain("Entrar · anthropic");
	expect(shown).toContain("open this page");
	expect(shown).toContain("https://claude.ai/oauth/authorize?code=true");
	expect(shown).toContain("Paste the code");

	screen.finish();
	await expect(pending).rejects.toThrow("cancelled");
});

test("a long URL wraps instead of being cut", () => {
	const screen = view();
	const url = `https://claude.ai/oauth/authorize?${"x".repeat(240)}`;
	screen.interaction().notify({ type: "auth_url", url });

	expect(rowText(screen.render(60))).toContain(url);
	screen.finish();
});

test("enter with an empty field leaves the question waiting", async () => {
	const screen = view();
	const pending = screen.interaction().prompt({ type: "text", message: "Paste the code" });
	screen.handleInput("\r");

	let answered = false;
	void pending.then(
		() => {
			answered = true;
		},
		() => {},
	);
	await Promise.resolve();
	expect(answered).toBe(false);

	screen.finish();
	await expect(pending).rejects.toThrow("cancelled");
});

test("the copy key takes the URL, since a headless session cannot click", async () => {
	const copied: string[] = [];
	const screen = new LoginView(TUI, THEME, "anthropic", new AbortController().signal, () => {}, {
		...QUIET,
		keybindings: {
			matches: (data: string, keybinding: string) =>
				keybinding === "app.message.copy" && data === "\u0018",
			getKeys: () => ["ctrl+x"],
		} as unknown as KeybindingsManager,
		copy: async (text) => {
			copied.push(text);
		},
	});
	const pending = screen.interaction().prompt({ type: "text", message: "Paste the code" });
	screen.interaction().notify({ type: "auth_url", url: "https://claude.ai/oauth" });

	screen.handleInput("\u0018");
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(copied).toEqual(["https://claude.ai/oauth"]);
	expect(visible(screen.render(72))).toContain("copied");

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

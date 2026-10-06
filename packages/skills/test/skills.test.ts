import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import {
	createSyntheticSourceInfo,
	initTheme,
	type MarkdownTransformer,
	type MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";

import { completeSkills } from "../src/complete.ts";
import { skillBlock, skills, SKILLS_MESSAGE } from "../src/index.ts";

let dir: string;

function skillFile(name: string, body: string): string {
	const folder = join(dir, name);
	mkdirSync(folder, { recursive: true });
	const path = join(folder, "SKILL.md");
	writeFileSync(path, `---\nname: ${name}\ndescription: ${name} things\n---\n\n${body}\n`);
	return path;
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-skills-"));
	skillFile("simplify", "Make it simpler.");
	skillFile("unslop", "Remove the slop.");
	initTheme("dark", false);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function command(name: string) {
	return {
		name: `skill:${name}`,
		description: `${name} things`,
		source: "skill",
		sourceInfo: createSyntheticSourceInfo(join(dir, name, "SKILL.md"), { source: "test" }),
	};
}

interface Sent {
	message: { customType: string; content: { type: string; text: string }[]; display: boolean };
	options: unknown;
}

async function mounted() {
	const fake = fakePi();
	const sent: Sent[] = [];
	const renderers = new Map<string, MessageRenderer>();
	const transformers: MarkdownTransformer[] = [];
	const providers: ((current: AutocompleteProvider) => AutocompleteProvider)[] = [];
	Object.assign(fake.pi, {
		getCommands: () => [
			command("simplify"),
			command("unslop"),
			{ ...command("x"), source: "prompt" },
		],
		sendMessage: (message: Sent["message"], options: unknown) => sent.push({ message, options }),
		registerMessageRenderer: (type: string, renderer: MessageRenderer) =>
			renderers.set(type, renderer),
		registerMarkdownTransformer: (transformer: MarkdownTransformer) =>
			transformers.push(transformer),
	});
	createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") })
		.use(skills)
		.build();
	const ctx = fakeContext([], true, {
		ui: {
			theme: FAKE_THEME,
			addAutocompleteProvider: (factory: (current: AutocompleteProvider) => AutocompleteProvider) =>
				providers.push(factory),
		},
	});
	await fake.fire("session_start", {}, ctx);
	const input = async (text: string, extra: Record<string, unknown> = {}) =>
		(await fake.fire("input", { type: "input", text, source: "interactive", ...extra }, ctx))[0];
	return { fake, sent, renderers, transformers, providers, input };
}

/** Marks each color by name, so a test reads which ones a chip used. */
const FAKE_THEME = {
	fg: (color: string, text: string) => `<${color}>${text}</>`,
	bg: (color: string, text: string) => `[${color}]${text}[/]`,
	getFgAnsi: (color: string) => `<${color}>`,
	getBgAnsi: (color: string) => `[${color}]`,
};

describe("a message that names skills", () => {
	test("sends every skill it names first, and the text goes on as typed", async () => {
		const { sent, input } = await mounted();
		expect(await input("use /skill:simplify and then /skill:unslop")).toBeUndefined();

		expect(sent).toHaveLength(1);
		const { message, options } = sent[0]!;
		expect(message.customType).toBe(SKILLS_MESSAGE);
		expect(message.display).toBe(true);
		expect(message.content.map((part) => part.text)).toEqual([
			skillBlock({ name: "simplify", filePath: join(dir, "simplify", "SKILL.md") }),
			skillBlock({ name: "unslop", filePath: join(dir, "unslop", "SKILL.md") }),
		]);
		expect(options).toBeUndefined();
	});

	test("a message with no skill, or an unknown one, is left alone", async () => {
		const { sent, input } = await mounted();
		expect(await input("just /skill:nope and /x")).toBeUndefined();
		expect(sent).toEqual([]);
	});

	test("while the model works, the skills queue the way the message does", async () => {
		const { sent, input } = await mounted();
		await input("now /skill:unslop", { streamingBehavior: "steer" });
		expect(sent[0]?.options).toEqual({ deliverAs: "steer" });
	});

	test("one that starts with /skill: gets a space first, so pi does not expand it again", async () => {
		const { sent, input } = await mounted();
		const text = "/skill:simplify this file, then /skill:unslop";
		expect(await input(text)).toEqual({ action: "transform", text: ` ${text}` });
		expect(sent[0]?.message.content).toHaveLength(2);
	});
});

test("the skill block is the one pi writes for /skill:name", () => {
	const path = join(dir, "simplify", "SKILL.md");
	expect(skillBlock({ name: "simplify", filePath: path })).toBe(
		`<skill name="simplify" location="${path}">\nReferences are relative to ${join(dir, "simplify")}.\n\nMake it simpler.\n</skill>`,
	);
});

describe("in the chat", () => {
	test("a reference in your message becomes a chip, and the model's text is left alone", async () => {
		const { transformers } = await mounted();
		const [transform] = transformers;
		const context = { isStreaming: false, availableWidth: 80 };
		const drawn = transform!("use /skill:simplify now", { ...context, messageType: "user" });
		expect(drawn).toBe(
			"use [customMessageBg]\u00a0<customMessageLabel>\x1b[1m[skill]\x1b[22m</>\u00a0<customMessageText>simplify</>\u00a0[/][userMessageBg]<userMessageText> now",
		);
		// The space that kept pi from expanding a leading reference is not drawn.
		expect(transform!(" /skill:unslop", { ...context, messageType: "user" })).toStartWith(
			"[customMessageBg]",
		);
		expect(transform!("use /skill:simplify", { ...context, messageType: "assistant" })).toBe(
			"use /skill:simplify",
		);
	});

	test("the skills show nothing until the tool output expands", async () => {
		const { renderers, sent, input } = await mounted();
		await input("use /skill:simplify and /skill:unslop");
		const render = renderers.get(SKILLS_MESSAGE)!;
		const message = { role: "custom", ...sent[0]!.message, timestamp: 0 } as never;
		const theme = FAKE_THEME as never;

		expect(render(message, { expanded: false, outputPad: 1 }, theme)?.render(80)).toEqual([]);
		const open = render(message, { expanded: true, outputPad: 1 }, theme)!.render(80).join("\n");
		expect(open).toContain("Make it simpler.");
		expect(open).toContain("Remove the slop.");
	});
});

describe("completion", () => {
	const base: AutocompleteProvider = {
		getSuggestions: async () => ({ items: [{ value: "base", label: "base" }], prefix: "" }),
		applyCompletion: (lines, cursorLine, cursorCol) => ({ lines: ["base"], cursorLine, cursorCol }),
	};
	const provider = completeSkills(base, () => [
		{ name: "simplify", description: "s", filePath: "/s" },
		{ name: "unslop", filePath: "/u" },
		{ name: "ce-simplify-code", filePath: "/c" },
	]);
	const signal = new AbortController().signal;
	const suggest = (line: string, cursorLine = 0) =>
		provider.getSuggestions(cursorLine === 0 ? [line] : ["first", line], cursorLine, line.length, {
			signal,
		});

	test("a slash further into the text lists every skill, and only skills", async () => {
		const suggestions = await suggest("use /");
		expect(suggestions?.prefix).toBe("/");
		expect(suggestions?.items.map((item) => item.label)).toEqual([
			"skill:simplify",
			"skill:unslop",
			"skill:ce-simplify-code",
		]);
	});

	test("what you type after it narrows the list the way pi's palette does", async () => {
		expect((await suggest("use /sim"))?.items.map((item) => item.value)).toEqual([
			"/skill:simplify",
			"/skill:ce-simplify-code",
		]);
		expect((await suggest("use /skill:uns"))?.items.map((item) => item.value)).toEqual([
			"/skill:unslop",
		]);
	});

	test("the start of the message stays pi's palette, and a later line is text", async () => {
		expect(await suggest("/sim")).toMatchObject({ items: [{ value: "base" }] });
		expect((await suggest("/sim", 1))?.items[0]?.value).toBe("/skill:simplify");
	});

	test("puts the whole reference in, with one space after it", () => {
		const result = provider.applyCompletion(
			["use /si and more"],
			0,
			7,
			{ value: "/skill:simplify", label: "skill:simplify" },
			"/si",
		);
		expect(result).toEqual({
			lines: ["use /skill:simplify and more"],
			cursorLine: 0,
			cursorCol: 20,
		});
	});

	test("anything else goes to the completion pi already had", async () => {
		expect(await suggest("use @fi")).toMatchObject({ items: [{ value: "base" }] });
		expect(await suggest("use /zzz")).toMatchObject({ items: [{ value: "base" }] });
	});

	test("Tab opens it in any editor", () => {
		expect(provider.shouldTriggerFileCompletion?.(["use /"], 0, 5)).toBe(true);
	});

	test("the session adds it to the editor", async () => {
		const { providers } = await mounted();
		expect(providers).toHaveLength(1);
	});
});

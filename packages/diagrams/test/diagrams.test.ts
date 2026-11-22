import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";
import {
	type ImageProtocol,
	Markdown,
	resetCapabilitiesCache,
	setCapabilities,
} from "@earendil-works/pi-tui";

import { darkTheme } from "../../kit/src/dark-theme.ts";
import { ansiToHex, peleColors } from "../src/colors.ts";
import { withColors } from "../src/draw.ts";
import piDiagrams, { diagramTransformer } from "../src/index.ts";
import { longestDrawable } from "../src/partial.ts";

const theme = darkTheme();
const isImageLine = (line: string) => line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
const FLOW = "flowchart LR\n  A[Mermaid text] --> B[SVG]";

function transformer(images: ImageProtocol = "kitty"): MarkdownTransformer {
	return diagramTransformer({
		theme: () => theme,
		terminal: () => ({ background: { r: 16, g: 16, b: 20 } }),
		images: () => images,
		hyperlinks: () => false,
		cell: () => ({ widthPx: 9, heightPx: 18 }),
		rows: () => 30,
	});
}

function run(markdown: string, isStreaming = false, images: ImageProtocol = "kitty"): string {
	return transformer(images)(markdown, {
		messageType: "assistant",
		isStreaming,
		availableWidth: 80,
	});
}

function identity(text: string): string {
	return text;
}

function drawCount(text: string): number {
	if (text.includes("broken")) throw new Error("no");
	return text.split("\n").length;
}

async function prompt(customPrompt?: string): Promise<Record<string, string>> {
	const fake = fakePi();
	const transformers: MarkdownTransformer[] = [];
	(fake.pi as ExtensionAPI & { registerMarkdownTransformer: unknown }).registerMarkdownTransformer =
		(registered: MarkdownTransformer) => void transformers.push(registered);
	piDiagrams(fake.pi);
	const event = { systemPromptOptions: { customPrompt, sections: {} } };
	await fake.fire("before_agent_start", event as unknown as BeforeAgentStartEvent, fakeContext());
	expect(transformers).toHaveLength(1);
	return event.systemPromptOptions.sections;
}

function fenced(source: string, close = true): string {
	return `Before\n\n\`\`\`mermaid\n${source}\n${close ? "```\n\nAfter" : ""}`;
}

describe("a mermaid block", () => {
	// pi-tui writes an image only for a terminal it detected as able to show one.
	beforeAll(() => setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false }));
	afterAll(() => resetCapabilitiesCache());

	test("becomes a picture that keeps its rows in the transcript", () => {
		const out = run(fenced(FLOW));
		const plain = new Proxy({}, { get: () => identity }) as never;
		const lines = new Markdown(out, 0, 0, plain).render(80);
		const image = lines.findIndex(isImageLine);
		const rows = Number(/,r=(\d+),/.exec(lines[image] ?? "")?.[1]);

		expect(out).not.toContain("```mermaid");
		expect(rows).toBeGreaterThan(1);
		expect(lines.slice(0, image).join("").trim()).toBe("Before");
		expect(lines.slice(image + 1, image + rows).every((line) => line.trim() === "")).toBe(true);
		expect(lines.at(-1)?.trim()).toBe("After");
	});

	test("is drawn from the lines already written while it streams", () => {
		const streamed = `${FLOW}\n  B --> C`;
		const partial = run(fenced(streamed, false), true);
		const whole = run(fenced(FLOW), false);
		const imageOf = (markdown: string) => markdown.split("\n").find(isImageLine);

		expect(imageOf(partial)).toBeDefined();
		expect(imageOf(partial)).toBe(imageOf(whole) ?? "");
	});

	test("stays as source while no line of it draws yet", () => {
		const out = run(fenced("flowchart LR\n  A[Merm", false), true);
		expect(out).toContain("```mermaid\nflowchart LR\n  A[Merm");
		expect(out.split("\n").some(isImageLine)).toBe(false);
	});

	test("that does not parse keeps its source and says why", () => {
		const out = run(fenced("flowchart LR\n  A[open --> B"));
		expect(out).toContain("```mermaid\nflowchart LR\n  A[open --> B\n```");
		expect(out).toContain("Diagram not drawn:");
		expect(out.split("\n").some(isImageLine)).toBe(false);
	});

	test("is Unicode art where the terminal shows no images", () => {
		const out = run(fenced(FLOW), false, null);
		expect(out).not.toContain("```mermaid");
		expect(out).toContain("Mermaid text");
		expect(out).toContain("┌");
		expect(out.split("\n").some(isImageLine)).toBe(false);
	});

	test("is left alone when there is no terminal to draw on", () => {
		const markdown = fenced(FLOW);
		const out = diagramTransformer({
			theme: () => undefined,
			terminal: () => ({}),
			images: () => "kitty",
			hyperlinks: () => false,
			cell: () => ({ widthPx: 9, heightPx: 18 }),
			rows: () => 30,
		})(markdown, { messageType: "assistant", isStreaming: false, availableWidth: 80 });
		expect(out).toBe(markdown);
	});
});

describe("the colors", () => {
	test("come from the theme, with the background the terminal reported", () => {
		const colors = peleColors(theme, { background: { r: 16, g: 16, b: 20 } });
		expect(colors.fg).toBe(ansiToHex(theme.getFgAnsi("text")) ?? "");
		expect(colors.line).toBe(ansiToHex(theme.getFgAnsi("accent")) ?? "");
		expect(colors.bg).toBe("#101014");
		expect(colors.surface).toBe("transparent");
	});

	test("read truecolor and the 256-color palette", () => {
		expect(ansiToHex("\x1b[38;2;167;152;215m")).toBe("#a798d7");
		expect(ansiToHex("\x1b[38;5;196m")).toBe("#ff0000");
		expect(ansiToHex("\x1b[38;5;244m")).toBe("#808080");
		expect(ansiToHex("\x1b[39m")).toBeUndefined();
	});

	test("replace every CSS variable, nested ones too, since resvg reads none", () => {
		const svg =
			'<svg style="--_bg:var(--pele-bg,#fff);--_l:var(--pele-line,#1f1f1f)" fill="var(--_l)"><rect fill="var(--_bg)"/><text fill="var(--pele-series-9,var(--pele-accent,#5b7bd5))"/></svg>';
		const out = withColors(svg, { line: "#a798d7", accent: "#111111" });
		expect(out).not.toContain("var(");
		expect(out).toContain('fill="#a798d7"');
		expect(out).toContain('<rect fill="#fff"/>');
		expect(out).toContain('<text fill="#111111"/>');
	});
});

describe("the longest run that draws", () => {
	test("drops the line still being written", () => {
		expect(longestDrawable("a\nb\nc", false, drawCount)?.lines).toBe(2);
		expect(longestDrawable("a\nb\nc", true, drawCount)?.lines).toBe(3);
	});

	test("stops before the first line that does not draw", () => {
		expect(longestDrawable("a\nb\nbroken\nd\ne", true, drawCount)?.text).toBe("a\nb");
	});

	test("tries only runs longer than the one it already has", () => {
		expect(longestDrawable("a\nb\nbroken\nd", true, drawCount, 2)).toBeUndefined();
	});
});

describe("the model", () => {
	test("is told it can draw, and where the syntax of each type is", async () => {
		const sections = await prompt();
		expect(sections.diagrams).toContain("```mermaid");
		expect(sections.diagrams).toContain("https://pele.run/examples.md");
		expect(sections.diagrams).toContain("treeView-beta");
	});

	test("is not told when the user wrote the whole prompt", async () => {
		expect((await prompt("You are a poet.")).diagrams).toBeUndefined();
	});
});

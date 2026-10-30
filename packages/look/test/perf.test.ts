// A redraw the person at the keyboard did not ask for must cost nothing. Typing redraws the screen,
// and a component that paints itself again on every one of those redraws is what makes typing lag.
import { describe, expect, test } from "bun:test";

import { createApp, RULING } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { look } from "../src/index.ts";
import { StripComponent } from "../src/ui/footer.ts";
import { screen, snapshot } from "./helpers.ts";

function frame(theme: Theme) {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	RULING.provide({ events: fake.pi.events, warn: () => {} }, () => ({
		tone: "success",
		head: "judge approved",
	}));

	const base: ToolRenderers = {
		renderCall: () => new Text("$ bun run test", 0, 0),
		renderResult: () => new Text("583 pass", 0, 0),
	};
	const resolveAt = (index: number): ToolRenderers | undefined =>
		index < fake.toolRenderers.length
			? fake.toolRenderers[index]!("bash", () => resolveAt(index + 1))
			: base;
	const chain = resolveAt(0);
	if (chain?.renderCall === undefined) throw new Error("no renderers");
	const component = chain.renderCall({ command: "bun run test" }, theme, {
		toolCallId: "call-1",
		invalidate: () => {},
		state: {},
		expanded: false,
		isPartial: false,
		isError: false,
		executionStarted: true,
		cwd: "/repo",
	} as never);
	return component;
}

/** An edit pi has finished, holding its diff the way pi's edit component does. */
function editFrame(theme: Theme, diff: string) {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	const base: ToolRenderers = {
		renderCall: () => Object.assign(new Text("edit a.ts", 0, 0), { preview: { diff } }),
	};
	const chain = fake.toolRenderers[0]?.("edit", () => base);
	const component = chain?.renderCall?.(
		{ path: "a.ts", edits: [{ oldText: "a", newText: "b" }] },
		theme,
		{
			toolCallId: "edit-1",
			invalidate: () => {},
			state: {},
			expanded: false,
			isPartial: false,
			isError: false,
			argsComplete: true,
			executionStarted: true,
			cwd: "/repo",
		} as never,
	);
	if (component === undefined) throw new Error("no edit renderer");
	return component;
}

/** As pi writes a diff: a line taken out, a line put in, and the context around them. */
function diffOf(lines: number): string {
	return Array.from({ length: lines }, (_, index) => {
		const number = index + 1;
		if (index % 3 === 1) return `-${number} const value${number} = ${number};`;
		if (index % 3 === 2) return `+${number - 1} const renamed${number} = ${number};`;
		return ` ${number} context line ${number}`;
	}).join("\n");
}

/** A theme that counts what it paints; `painted.count` goes back to 0 by hand. */
function countingTheme(): { theme: Theme; painted: { count: number } } {
	const painted = { count: 0 };
	const paint = (text: string) => {
		painted.count++;
		return text;
	};
	const theme = {
		fg: (_color: string, text: string) => paint(text),
		bg: (_color: string, text: string) => paint(text),
		bold: paint,
	} as unknown as Theme;
	return { theme, painted };
}

describe("the cost of a redraw", () => {
	test("paints an edit's diff again only when something changed", () => {
		const { theme, painted } = countingTheme();
		const component = editFrame(theme, diffOf(30));
		component.render(60);
		expect(painted.count).toBeGreaterThan(0);

		painted.count = 0;
		component.render(60);
		expect(painted.count).toBe(0);

		// A narrower screen is a new drawing.
		component.render(50);
		expect(painted.count).toBeGreaterThan(0);
	});

	test("redraws an unchanged edit as fast however long its diff", () => {
		// Colored as on a terminal: a line with escapes costs more to read than plain text.
		const colored = {
			fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[39m`,
			bg: (_color: string, text: string) => `\x1b[41m${text}\x1b[49m`,
			bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
		} as unknown as Theme;
		const component = editFrame(colored, diffOf(2000));
		component.render(80);

		const started = performance.now();
		for (let index = 0; index < 200; index++) component.render(80);
		// Drawing the diff again on every redraw took about 6ms here, sixty times this.
		expect((performance.now() - started) / 200).toBeLessThan(0.1);
	});

	test("paints a call again only when something changed", () => {
		const { theme, painted } = countingTheme();
		const component = frame(theme);
		component.render(60);
		expect(painted.count).toBeGreaterThan(0);

		painted.count = 0;
		component.render(60);
		expect(painted.count).toBe(0);

		// A narrower screen is a new drawing.
		component.render(50);
		expect(painted.count).toBeGreaterThan(0);
	});

	test("redraws an unchanged call fast enough to type over", () => {
		const plain = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		} as unknown as Theme;
		const component = frame(plain);
		component.render(60);

		const started = performance.now();
		for (let index = 0; index < 200; index++) component.render(60);
		// The frame that repainted itself on every redraw took 0.27ms, forty times this.
		expect((performance.now() - started) / 200).toBeLessThan(0.1);
	});

	test("the strip keeps its drawing until something says the screen changed", () => {
		const data = snapshot();
		let reads = 0;
		const fixture = screen(data, {
			snapshot: () => {
				reads++;
				return data;
			},
		});
		const strip = new StripComponent(fixture);

		const first = strip.render(80);
		const readsOfTheFirstDrawing = reads;
		expect(strip.render(80)).toBe(first);
		expect(reads).toBe(readsOfTheFirstDrawing);

		// An event, a probe or a new branch is drawn when it happens, not on the next keystroke.
		fixture.bump();
		expect(strip.render(80)).not.toBe(first);
		expect(reads).toBeGreaterThan(readsOfTheFirstDrawing);

		const second = strip.render(80);
		strip.invalidate();
		expect(strip.render(80)).not.toBe(second);
	});
});

import { expect, test } from "bun:test";

import { fakeContext } from "@adeildo/pi-kit/testing";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type SelectListTheme, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import { FramedSelect, pick } from "../src/ui/picker.ts";

const LIST: SelectListTheme = {
	selectedPrefix: (text) => text,
	selectedText: (text) => text,
	description: (text) => text,
	scrollInfo: (text) => text,
	noMatch: (text) => text,
};

const THEME = { fg: (_role: string, text: string) => text } as unknown as Theme;
const TUI = { requestRender: () => {} } as unknown as TUI;

test("a host without our frame answers with pi's select", async () => {
	const ctx = fakeContext([], true, {
		mode: "rpc",
		ui: { select: async (_title: string, options: string[]) => options[1] },
	});
	expect(await pick(ctx, "Title", ["one", "two"])).toBe("two");
});

test("no options is no dialog", async () => {
	const ctx = fakeContext([], true, {
		mode: "rpc",
		ui: {
			select: async () => {
				throw new Error("asked with nothing to choose");
			},
		},
	});
	expect(await pick(ctx, "Title", [])).toBeUndefined();
});

test("the frame holds the title, the options and the hint", () => {
	const width = 40;
	const component = new FramedSelect(TUI, THEME, "Pick one", ["alpha", "beta"], () => {}, LIST);
	const lines = component.render(width);
	const body = lines.join("\n");

	expect(lines[0]?.startsWith("╭─ Pick one ")).toBe(true);
	expect(lines.at(-1)).toBe(`╰${"─".repeat(width - 2)}╯`);
	expect(body).toContain("alpha");
	expect(body).toContain("enter");
	for (const line of lines) expect(visibleWidth(line)).toBe(width);
});

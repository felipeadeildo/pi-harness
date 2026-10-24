// The row above the editor: who has the keys, what the reader had typed, how tall the dialog gets, and
// that only one is open at a time. What each feature draws is the feature's own test.
import { describe, expect, test } from "bun:test";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { openAboveEditor } from "../src/ui/above-editor.ts";

interface Drawn {
	render(width: number): string[];
	handleInput(data: string): void;
}

/**
 * A host that behaves like pi's terminal: the widget factory is called when the widget is set, the
 * input handler is called for every key, and the editor keeps its own text.
 */
function host(editor = "") {
	let drawn: Drawn | undefined;
	let input: (data: string) => { consume?: boolean; data?: string } | undefined = () => undefined;
	let text = editor;
	let opened = 0;
	let mostOpen = 0;
	const built: (() => void)[] = [];
	const ready = (count: number): Promise<void> =>
		built.length >= count ? Promise.resolve() : new Promise((resolve) => built.push(resolve));

	const ui = {
		getEditorText: () => text,
		setEditorText: (next: string) => {
			text = next;
		},
		setWidget: (_key: string, content: unknown) => {
			if (content === undefined) {
				opened -= 1;
				return;
			}
			opened += 1;
			mostOpen = Math.max(mostOpen, opened);
			drawn = (content as (tui: unknown, theme: unknown) => Drawn)(
				{ terminal: { rows: 24 }, requestRender: () => {} },
				{
					fg: (_color: string, one: string) => one,
					bold: (one: string) => one,
				},
			);
			for (const resolve of built.splice(0)) resolve();
		},
		onTerminalInput: (handler: typeof input) => {
			input = handler;
			return () => {
				input = () => undefined;
			};
		},
	} as unknown as ExtensionUIContext;

	return {
		ui,
		ready,
		get drawn(): Drawn {
			return drawn as Drawn;
		},
		get mostOpen(): number {
			return mostOpen;
		},
		type: (data: string) => (input as (data: string) => unknown)(data),
		get editor(): string {
			return text;
		},
	};
}

const ALT_E = "\u001be";

describe("the row above the editor", () => {
	test("a key goes to the editor while the editor has the focus", async () => {
		const rig = host();
		const seen: string[] = [];
		const opened = openAboveEditor<string>(rig.ui, (tools) => ({
			render: () => ["Ship it?"],
			handleInput: (data) => {
				seen.push(data);
				tools.done("yes");
			},
		}));
		await rig.ready(1);
		// Nobody typed before it opened, so the dialog has the keys: this one is its answer.
		expect(rig.type("1")).toEqual({ consume: true });
		expect(await opened.result).toEqual({ value: "yes", typed: "" });
		expect(seen).toEqual(["1"]);
	});

	test("the alt+e key hands the keys to the editor and takes them back", async () => {
		const rig = host();
		let focused: boolean | undefined;
		const opened = openAboveEditor<string>(rig.ui, (tools) => ({
			render: () => {
				focused = tools.focused();
				return [focused ? "dialog" : "dialog (quiet)"];
			},
			handleInput: () => {},
		}));
		await rig.ready(1);
		rig.drawn.render(40);
		expect(focused).toBe(true);
		rig.type(ALT_E);
		rig.drawn.render(40);
		expect(focused).toBe(false);
		// The editor has the keys now, so a letter is its text and not the dialog's.
		expect(rig.type("a")).toBeUndefined();
		rig.type(ALT_E);
		rig.drawn.render(40);
		expect(focused).toBe(true);
		expect(rig.type("a")).toEqual({ consume: true });
		opened.close();
		expect(await opened.result).toBeUndefined();
	});

	test("sending the answer carries the editor's text and leaves it empty", async () => {
		const rig = host("typed before");
		const opened = openAboveEditor<string>(rig.ui, (tools) => ({
			render: () => [],
			handleInput: (data) => {
				if (data === "enter") tools.done("yes");
			},
		}));
		await rig.ready(1);
		rig.type("enter");
		expect(await opened.result).toEqual({ value: "yes", typed: "typed before" });
		expect(rig.editor).toBe("");
	});

	test("escape closes with no answer and leaves the editor as it was", async () => {
		const rig = host("half a thought");
		const opened = openAboveEditor<string>(rig.ui, () => ({
			render: () => ["Ship it?"],
			handleInput: () => {},
		}));
		await rig.ready(1);
		rig.type("\u001b");
		expect(await opened.result).toBeUndefined();
		expect(rig.editor).toBe("half a thought");
	});

	test("the dialog is told how many rows it may use", async () => {
		const rig = host();
		let rows: number | undefined;
		const opened = openAboveEditor<string>(rig.ui, (tools) => {
			rows = tools.rows();
			return { render: () => [], handleInput: () => {} };
		});
		await rig.ready(1);
		rig.drawn.render(40);
		expect(rows).toBe(24);
		opened.close();
		await opened.result;
	});

	test("the row only grows while the dialog is open", async () => {
		const rig = host();
		let lines = 1;
		const opened = openAboveEditor<string>(rig.ui, (tools) => ({
			render: () => Array.from({ length: lines }, (_, one) => `row ${one}`),
			handleInput: (data) => tools.done(data),
		}));
		await rig.ready(1);
		// The frame adds its two edges, and the body is padded to the tallest drawn so far.
		lines = 1;
		const first = rig.drawn.render(40).length;
		lines = 5;
		const tallest = rig.drawn.render(40).length;
		lines = 2;
		const shorter = rig.drawn.render(40).length;
		opened.close();
		await opened.result;
		expect([first, tallest, shorter]).toEqual([3, 7, 7]);
	});

	test("a second dialog waits for the first", async () => {
		const rig = host();
		const view = (tools: { done(value: string): void }) => ({
			render: () => [],
			handleInput: (data: string) => tools.done(data),
		});
		const first = openAboveEditor<string>(rig.ui, view);
		const second = openAboveEditor<string>(rig.ui, view);
		await rig.ready(1);
		rig.type("1");
		await rig.ready(2);
		rig.type("2");
		expect((await first.result)?.value).toBe("1");
		expect((await second.result)?.value).toBe("2");
		expect(rig.mostOpen).toBe(1);
	});
});

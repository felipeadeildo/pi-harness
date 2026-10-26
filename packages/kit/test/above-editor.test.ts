// The row above the editor: who has the keys, what the reader had typed, how tall the dialog gets, and
// that only one is open at a time. What each feature draws is the feature's own test.
import { describe, expect, test } from "bun:test";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { openAboveEditor, watchEditor } from "../src/ui/above-editor.ts";

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
	// pi gives every key to every listener, and the answer that consumes it is the one that counts.
	const listeners: ((data: string) => { consume?: boolean } | undefined)[] = [];
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
		onTerminalInput: (handler: (data: string) => { consume?: boolean } | undefined) => {
			listeners.push(handler);
			return () => {
				const at = listeners.indexOf(handler);
				if (at >= 0) listeners.splice(at, 1);
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
		type: (data: string) => {
			let answer: { consume?: boolean } | undefined;
			const all = listeners.slice();
			for (const listener of all) answer = listener(data) ?? answer;
			return answer;
		},
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

	test("a key is typed once: the terminal's release of it is not a second key", async () => {
		const rig = host();
		const seen: string[] = [];
		const opened = openAboveEditor<string>(rig.ui, () => ({
			render: () => ["Name?"],
			handleInput: (data) => {
				seen.push(data);
			},
		}));
		await rig.ready(1);
		// A terminal speaking the kitty protocol sends a press and a release for each key, and pi's
		// listeners get both. Typing "ab" fast: a down, b down, a up, b up.
		for (const data of ["a", "b", "\u001b[97;1:3u", "\u001b[98;1:3u"]) {
			expect(rig.type(data)).toEqual({ consume: true });
		}
		expect(seen).toEqual(["a", "b"]);
		// Alt+E is read on its press only: its release does not hand the keys back.
		rig.type(ALT_E);
		rig.type("\u001b[101;3:3u");
		expect(rig.type("c")).toBeUndefined();
		opened.close();
		expect(await opened.result).toBeUndefined();
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

	test("a dialog opened right after a key leaves the focus with the editor", async () => {
		const rig = host();
		// The session start is where the extension watches the editor, and it is the only place: the
		// dialog does not install the clock itself, so this is the production order.
		watchEditor(rig.ui);
		// The reader is typing: the key goes to the editor, which is what makes the time count.
		rig.type("h");
		let focused: boolean | undefined;
		const opened = openAboveEditor<string>(rig.ui, (tools) => ({
			render: () => {
				focused = tools.focused();
				return [];
			},
			handleInput: () => {},
		}));
		await rig.ready(1);
		rig.drawn.render(40);
		expect(focused).toBe(false);
		// The dialog does not have the keys, so this one is still the editor's.
		expect(rig.type("i")).toBeUndefined();
		opened.close();
		await opened.result;
	});

	test("a dialog opened long after the last key takes the focus", async () => {
		const rig = host();
		rig.type("h");
		let focused: boolean | undefined;
		const opened = openAboveEditor<string>(
			rig.ui,
			(tools) => ({
				render: () => {
					focused = tools.focused();
					return [];
				},
				handleInput: () => {},
			}),
			{ recentMs: 0 },
		);
		await rig.ready(1);
		rig.drawn.render(40);
		expect(focused).toBe(true);
		expect(rig.type("i")).toEqual({ consume: true });
		opened.close();
		await opened.result;
	});

	test("a new host gets its own tracker, so the keystroke clock keeps moving", async () => {
		const first = host();
		watchEditor(first.ui);
		first.type("h");
		const one = openAboveEditor<string>(first.ui, (tools) => ({
			render: () => (tools.focused() ? ["dialog"] : ["quiet"]),
			handleInput: () => {},
		}));
		await first.ready(1);
		one.close();
		await one.result;

		// Another context: the listener the old one installed no longer exists, and a tracker bound to
		// it would never see a key again — every dialog after that would take the focus from a reader.
		const second = host();
		watchEditor(second.ui);
		second.type("h");
		let focused: boolean | undefined;
		const two = openAboveEditor<string>(second.ui, (tools) => ({
			render: () => {
				focused = tools.focused();
				return [];
			},
			handleInput: () => {},
		}));
		await second.ready(1);
		second.drawn.render(40);
		expect(focused).toBe(false);
		two.close();
		await two.result;
	});

	test("a second dialog waits for the first", async () => {
		const rig = host();
		const view = (tools: { done(value: string): void }) => ({
			render: () => [],
			handleInput: (data: string) => tools.done(data),
		});
		const first = openAboveEditor<string>(rig.ui, view, { recentMs: 0 });
		const second = openAboveEditor<string>(rig.ui, view, { recentMs: 0 });
		await rig.ready(1);
		rig.type("1");
		await rig.ready(2);
		rig.type("2");
		expect((await first.result)?.value).toBe("1");
		expect((await second.result)?.value).toBe("2");
		expect(rig.mostOpen).toBe(1);
	});

	test("a view that cannot be built rejects its dialog, and the next one still opens", async () => {
		const rig = host();
		const broken = openAboveEditor<string>(
			rig.ui,
			() => {
				throw new Error("boom");
			},
			{ recentMs: 0 },
		);
		const next = openAboveEditor<string>(
			rig.ui,
			(tools) => ({ render: () => [], handleInput: (data) => tools.done(data) }),
			{ recentMs: 0 },
		);
		const built = rig.ready(1);
		await expect(broken.result).rejects.toThrow("boom");
		await built;
		rig.type("1");
		expect((await next.result)?.value).toBe("1");
	});

	test("a view that reads Escape itself decides what it ends with", async () => {
		const rig = host();
		const opened = openAboveEditor<string>(
			rig.ui,
			(tools) => ({
				render: () => [],
				handleInput: (data) => tools.done(data === "\u001b" ? "cancelled" : data),
			}),
			{ recentMs: 0, escape: "view" },
		);
		await rig.ready(1);
		rig.type("\u001b");
		expect((await opened.result)?.value).toBe("cancelled");
	});
});

describe("a host with nothing to listen to", () => {
	test("watching its editor is not an error, it is nothing to do", () => {
		// A session with no terminal has no input to listen to. Asking it to watch would throw inside
		// the session start and be reported as a failed start, which is the bug this pins.
		expect(() => watchEditor({} as never)).not.toThrow();
	});
});

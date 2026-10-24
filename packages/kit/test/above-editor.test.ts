// The slot above the editor: who reads the keys, how tall it may get, and that only one dialog holds
// it. What each feature draws is the feature's own test; this is the row they share.
import { describe, expect, test } from "bun:test";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { openAboveEditor } from "../src/ui/above-editor.ts";

interface Drawn {
	render(width: number): string[];
	handleInput(data: string): void;
}

interface Overlay {
	readonly overlayOptions: () => { maxHeight: number };
}

/** A host that runs the factory when asked, as pi does, and hands back the component it built. */
function host(editor = "") {
	let drawn: Drawn | undefined;
	let overlay: Overlay | undefined;
	let settle: (value: unknown) => void = () => {};
	let builds = 0;
	const waiters: (() => void)[] = [];
	/** Resolves once `count` dialogs have been built, so each one is waited for in turn. */
	const builtAtLeast = (count: number): Promise<void> =>
		builds >= count
			? Promise.resolve()
			: new Promise<void>((resolve) => {
					waiters.push(resolve);
				});
	let most = 0;
	let open = 0;
	const ui = {
		getEditorText: () => editor,
		custom: (factory: unknown, options: Overlay) => {
			open += 1;
			most = Math.max(most, open);
			overlay = options;
			return new Promise((resolve) => {
				settle = (value) => {
					open -= 1;
					resolve(value);
				};
				drawn = (
					factory as (
						tui: unknown,
						theme: unknown,
						keys: unknown,
						finish: (value: unknown) => void,
					) => Drawn
				)({}, {}, {}, settle);
				builds += 1;
				for (const waiter of waiters.splice(0)) waiter();
			});
		},
	} as unknown as ExtensionUIContext;
	return {
		ui,
		builtAtLeast,
		/** The component the factory built, once the slot opened it. */
		get drawn(): Drawn {
			return drawn as Drawn;
		},
		get overlay(): Overlay {
			return overlay as Overlay;
		},
		get most(): number {
			return most;
		},
	};
}

describe("the slot above the editor", () => {
	test("the dialog reads every key while it is open", async () => {
		const host_ = host("typed");
		const seen: string[] = [];
		const opened = openAboveEditor<string>(host_.ui, (slot) => ({
			render: () => ["Ship it?"],
			handleInput: (data) => {
				seen.push(data);
				if (data === "1") slot.finish("yes");
			},
			finish: slot.finish,
		}));
		await host_.builtAtLeast(1);
		expect(host_.drawn.render(40)).toEqual(["Ship it?"]);
		host_.drawn.handleInput("x");
		host_.drawn.handleInput("1");
		// The key it did not read went nowhere: it is not handed to the editor under the dialog.
		expect(seen).toEqual(["x", "1"]);
		expect(await opened).toBe("yes");
	});

	test("the editor's text is read when the dialog finishes, not when it opens", async () => {
		let editor = "typed before";
		const host_ = host();
		(host_.ui as unknown as { getEditorText: () => string }).getEditorText = () => editor;
		const opened = openAboveEditor<string>(host_.ui, (slot) => ({
			render: () => [],
			handleInput: (data) => {
				if (data === "enter") slot.finish(slot.editor());
			},
			finish: slot.finish,
		}));
		await host_.builtAtLeast(1);
		editor = "typed while it was open";
		host_.drawn.handleInput("enter");
		expect(await opened).toBe("typed while it was open");
	});

	test("the height only grows while the dialog is open", async () => {
		const host_ = host();
		let lines = 1;
		const opened = openAboveEditor<string>(host_.ui, (slot) => ({
			render: () => Array.from({ length: lines }, (_, one) => `row ${one}`),
			handleInput: (data) => slot.finish(data),
			finish: slot.finish,
		}));
		await host_.builtAtLeast(1);
		// The host draws on its own, and reads the height from what it is given, so the frame is the
		// measure: five lines once, then three, and the third frame is still five lines tall.
		lines = 1;
		const first = host_.drawn.render(40).length;
		lines = 5;
		const tallest = host_.drawn.render(40).length;
		lines = 2;
		const shorter = host_.drawn.render(40);
		host_.drawn.handleInput("done");
		await opened;
		expect([first, tallest, shorter.length]).toEqual([1, 5, 5]);
		expect(shorter.slice(2)).toEqual(["", "", ""]);
	});

	test("no height is set for the host unless the caller asks for one", async () => {
		const host_ = host();
		const opened = openAboveEditor<string>(host_.ui, (slot) => ({
			render: () => ["Ship it?"],
			handleInput: (data) => slot.finish(data),
			finish: slot.finish,
		}));
		await host_.builtAtLeast(1);
		expect(host_.overlay.overlayOptions).toEqual({ anchor: "bottom-center" });
		host_.drawn.handleInput("done");
		await opened;
	});

	test("a second dialog waits for the first", async () => {
		const host_ = host();
		const view = (slot: { finish(value: string): void }) => ({
			render: () => [],
			handleInput: () => slot.finish("one"),
			finish: slot.finish,
		});
		const opened = [
			openAboveEditor<string>(host_.ui, view),
			openAboveEditor<string>(host_.ui, view),
			openAboveEditor<string>(host_.ui, view),
		];
		for (let one = 1; one <= 3; one += 1) {
			await host_.builtAtLeast(one);
			host_.drawn.handleInput("1");
		}
		expect(await Promise.all(opened)).toEqual(["one", "one", "one"]);
		expect(host_.most).toBe(1);
	});
});

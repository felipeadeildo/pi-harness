// The one row that belongs to nobody: the line above the editor, where a dialog asks something while
// the reader keeps the text they were typing. The editor stays where it is, visible and usable, and
// the dialog borrows the keys only while it has the focus.
//
// Each feature brings its own view. This owns the slot: who has the keys, the frame that says so, the
// text the reader had typed, and that only one dialog is open at a time.
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type KeyId, matchesKey } from "@earendil-works/pi-tui";

import { frame } from "./frame.ts";

/** The key that moves the focus between the dialog and the editor, as the bottom edge says. */
export const ABOVE_EDITOR_FOCUS_KEY = "alt+e";

/** How recently the reader typed for the editor to keep the focus when a dialog opens. */
const RECENT_MS = 1_000;

/** What a view is given when it opens. */
export interface AboveEditorTools<T> {
	/** Ends the dialog with this value; the editor's text goes with it. */
	done(value: T): void;
	/** Whether the dialog has the keys right now. */
	focused(): boolean;
	/** The rows the dialog may use, so it can fit inside them instead of being cut. */
	rows(): number;
}

/** What a feature draws. */
export interface AboveEditorView {
	render(width: number): string[];
	/** Reads a key. A key it does not read is dropped, never handed to the editor under it. */
	handleInput(data: string): void;
}

export interface AboveEditorResult<T> {
	value: T;
	/** The editor's text at the moment the reader sent the answer, and the editor is empty after it. */
	typed: string;
}

export interface AboveEditor<T> {
	/** What the dialog decided, with the text the editor had. `undefined` when it was closed or escaped. */
	result: Promise<AboveEditorResult<T> | undefined>;
	/** Closes the dialog without answering, leaving the editor as it is. */
	close(): void;
}

export interface AboveEditorOptions {
	/** What the dialog is, in the top edge of its frame. */
	title?: string;
	/** How recently the reader typed for the editor to keep the focus. */
	recentMs?: number;
}

/** Only one dialog holds the row: a second one waits for the first to finish. */
let queue: Promise<unknown> = Promise.resolve();
/** When a key last went to the editor, so a dialog does not steal the focus from a reader typing. */
let lastTypedAt = 0;
let tracked: { ui: ExtensionUIContext; stop: () => void } | undefined;
/** The dialog that is open, if one is: a key it consumes never reached the editor. */
let active: { focused(): boolean } | undefined;

/**
 * Keeps the time of the last key the editor got. It belongs at session start, not at the first
 * dialog: a reader already typing when a question arrives must keep the keys. A new host gets its own
 * listener, because after a session change the old one is gone and a tracker bound to it would freeze
 * the time at "nobody is typing".
 */
export function watchEditor(ui: ExtensionUIContext): void {
	if (tracked?.ui === ui) return;
	tracked?.stop();
	tracked = {
		ui,
		stop: ui.onTerminalInput(() => {
			// A key the open dialog takes never went to the editor, so it is not evidence that the
			// reader is typing there.
			if (active?.focused() !== true) lastTypedAt = Date.now();
			return undefined;
		}),
	};
}

/**
 * Opens a dialog in the row above the editor. The editor keeps its text and stays usable: the dialog
 * holds the keys until `Alt+E` hands them over, and takes them back the same way. The view is told how
 * many rows it has, so it fits inside them rather than being cut where it matters.
 */
export function openAboveEditor<T>(
	ui: ExtensionUIContext,
	make: (tools: AboveEditorTools<T>) => AboveEditorView,
	options: AboveEditorOptions = {},
): AboveEditor<T> {
	let settle: (value: AboveEditorResult<T> | undefined) => void = () => {};
	const result = new Promise<AboveEditorResult<T> | undefined>((resolve) => {
		settle = resolve;
	});

	let abandoned = false;
	let stop = (): void => {};
	let started = (): void => {};
	/** The close of the dialog that is open, so a caller outside it takes the same path. */
	let shut = (): void => {};

	const run = (): void => {
		// Closed before it opened: nothing is drawn, and the row is free for the next dialog.
		if (abandoned) return;
		const recent = Date.now() - lastTypedAt < (options.recentMs ?? RECENT_MS);
		let focused = !recent;
		let tallest = 0;
		let finished = false;
		let view: AboveEditorView | undefined;
		let redraw = (): void => {};

		shut = () => close(undefined);
		const close = (value: AboveEditorResult<T> | undefined): void => {
			if (finished) return;
			finished = true;
			active = undefined;
			ui.setWidget(KEY, undefined);
			stop();
			settle(value);
			started();
		};

		ui.setWidget(
			KEY,
			(tui, theme: Theme) => {
				const rows = () => tui.terminal.rows;
				redraw = () => tui.requestRender();
				view ??= make({
					done: (value: T) => {
						// The text is read once, here, and the same value leaves the editor: what the reader
						// typed while the dialog was open is part of the answer.
						const typed = ui.getEditorText();
						ui.setEditorText("");
						close({ value, typed });
					},
					focused: () => focused,
					rows,
				});
				const drawn = view;
				return {
					invalidate(): void {},
					render(width: number): string[] {
						const lines = drawn.render(Math.max(1, width - 2));
						// The row grows and never shrinks: a shorter step is padded to the tallest drawn
						// so far, so the editor under it does not move.
						tallest = Math.max(tallest, lines.length);
						const body = [...lines, ...Array.from({ length: tallest - lines.length }, () => "")];
						return frame(theme, width, body, {
							title: options.title ?? "",
							keys: [
								["esc", "close"],
								[ABOVE_EDITOR_FOCUS_KEY, "editor"],
							],
							border: focused ? "accent" : "border",
						});
					},
					handleInput(data: string): void {
						drawn.handleInput(data);
					},
				};
			},
			{ placement: "aboveEditor" },
		);

		active = { focused: () => focused };
		stop = ui.onTerminalInput((data) => {
			if (finished) return undefined;
			if (matchesKey(data, ABOVE_EDITOR_FOCUS_KEY as KeyId)) {
				focused = !focused;
				lastTypedAt = focused ? 0 : Date.now();
				redraw();
				return { consume: true };
			}
			// The key never reaches the editor without the editor having the focus.
			if (!focused) {
				lastTypedAt = Date.now();
				return undefined;
			}
			if (matchesKey(data, "escape")) {
				close(undefined);
				return { consume: true };
			}
			view?.handleInput(data);
			redraw();
			return { consume: true };
		});
	};

	const turn = queue.then(run);
	queue = result.then(
		() => undefined,
		() => undefined,
	);
	started = () => {
		void turn;
	};

	return {
		result,
		close: () => {
			// Before the dialog opened, closing it only settles the promise; after, it takes the same
			// path as the dialog's own end, so the slot is released for the next one.
			abandoned = true;
			stop();
			ui.setWidget(KEY, undefined);
			settle(undefined);
			shut();
			started();
		},
	};
}

const KEY = "pi-kit:above-editor";

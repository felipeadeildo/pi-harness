// The one place that owns the row of the screen above the editor. A dialog drawn there takes every
// key while it is open, so nothing the reader types lands in the editor by accident, and it reads the
// editor's text once, at the moment the reader sends it.
//
// Each feature keeps its own view; this keeps the slot: who holds the keys, how tall it is, and that
// only one of them is open at a time.
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** What a feature draws: lines for the width it is given, and the keys it reads. */
export interface AboveEditorView<T> {
	render(width: number): string[];
	/** Reads a key. A key it does not read is dropped, never handed to the editor under it. */
	handleInput(data: string): void;
	/** Ends the dialog with what it decided. */
	finish(value: T): void;
}

/** What a view is given when it opens. */
export interface AboveEditorSlot<T> {
	/** Ends the dialog with this value; the promise `openAboveEditor` returns resolves with it. */
	finish(value: T): void;
	/** The editor's text, read when it is asked and never before: what was typed while the dialog was up counts. */
	editor(): string;
}

export interface AboveEditorOptions {
	/** The tallest the dialog may become, so a long one does not cover the screen it is read on. */
	maxHeight?: number;
}

/** Only one dialog holds the slot: a second one waits for the first to finish. */
let slot: Promise<unknown> = Promise.resolve();

/**
 * Opens `view` above the editor, exclusive: it reads every key until it calls `finish`. Resolves with
 * what the view finished with, or `undefined` when the host could not draw it.
 */
export function openAboveEditor<T>(
	ui: ExtensionUIContext,
	view: (slot: AboveEditorSlot<T>) => AboveEditorView<T>,
	options: AboveEditorOptions = {},
): Promise<T | undefined> {
	const run = (): Promise<T | undefined> => {
		let tallest = 0;
		let settled = false;
		const ended = ui.custom<T | undefined>(
			(_tui, _theme, _keybindings, done) => {
				const close = (value: T | undefined): void => {
					if (settled) return;
					settled = true;
					done(value);
				};
				const drawn = view({ finish: close, editor: () => ui.getEditorText() });
				return {
					invalidate(): void {},
					render(width: number): string[] {
						const lines = drawn.render(width);
						tallest = Math.max(tallest, lines.length);
						return lines;
					},
					handleInput(data: string): void {
						drawn.handleInput(data);
					},
				};
			},
			{
				overlay: true,
				// The height only grows while the dialog is open: a shorter step must not move the
				// editor under the reader's eyes any more than a shorter question moves a composer.
				overlayOptions: () => ({
					anchor: "bottom-center",
					maxHeight: options.maxHeight ?? tallest,
				}),
			},
		);
		return ended;
	};

	const next = slot.then(run, run);
	slot = next.catch(() => undefined);
	return next;
}

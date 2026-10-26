// The row above the editor, where a dialog asks while the editor keeps its text. One dialog at a
// time; it holds the keys until `Alt+E` hands them back. The keybindings come from
// `getKeybindings()`, since the widget factory does not pass them.
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, type KeyId, matchesKey } from "@earendil-works/pi-tui";

import { frame, frameInner, type KeyHint } from "./frame.ts";

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
	/** Draws the view again, for a view that changes without a key. */
	redraw(): void;
	theme: Theme;
}

export interface AboveEditorView {
	render(width: number): string[];
	/** Reads a key. A key it does not read is dropped, never handed to the editor under it. */
	handleInput(data: string): void;
	/** What the frame around the view says. A view without it gets the title of the options. */
	chrome?(): AboveEditorChrome;
}

export interface AboveEditorChrome {
	title: string;
	status?: string;
	keys?: readonly KeyHint[];
	/** The body line the pointer is on. */
	selected?: number;
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
	/** `view` lets a view use Escape to step back. */
	escape?: "close" | "view";
}

/** Per host, so a host that is gone decides nothing for the next one. */
interface Host {
	/** Only one dialog holds the row: a second one waits for the first to finish. */
	queue: Promise<unknown>;
	/** The dialog that is open, if one is: a key it consumes never reached the editor. */
	active?: { focused(): boolean };
	/** When a key last went to the editor, so a dialog does not steal the focus from a typing reader. */
	lastTypedAt: number;
	/** The listener that keeps that time, one per host. */
	tracked?: () => void;
}

const HOSTS = new WeakMap<ExtensionUIContext, Host>();

function hostOf(ui: ExtensionUIContext): Host {
	let host = HOSTS.get(ui);
	if (host === undefined) {
		host = { queue: Promise.resolve(), lastTypedAt: 0 };
		HOSTS.set(ui, host);
	}
	return host;
}

/** Called at session start, so a reader already typing when a question arrives keeps the keys. */
export function watchEditor(ui: ExtensionUIContext): void {
	// A host with no input to listen to (print, json) has no editor to keep the focus for.
	if (typeof ui.onTerminalInput !== "function") return;
	const host = hostOf(ui);
	if (host.tracked !== undefined) return;
	host.tracked = ui.onTerminalInput(() => {
		// A key the open dialog takes never went to the editor, so it is not evidence that the
		// reader is typing there.
		if (host.active?.focused() !== true) host.lastTypedAt = Date.now();
		return undefined;
	});
}

export function openAboveEditor<T>(
	ui: ExtensionUIContext,
	make: (tools: AboveEditorTools<T>) => AboveEditorView,
	options: AboveEditorOptions = {},
): AboveEditor<T> {
	let settle: (value: AboveEditorResult<T> | undefined) => void = () => {};
	let fail: (error: unknown) => void = () => {};
	const result = new Promise<AboveEditorResult<T> | undefined>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});

	let abandoned = false;
	let stop = (): void => {};
	let started = (): void => {};
	/** The close of the dialog that is open, so a caller outside it takes the same path. */
	let shut = (): void => {};

	const run = (): void => {
		// Closed before it opened: nothing is drawn, and the row is free for the next dialog.
		if (abandoned) return;
		const host = hostOf(ui);
		const recent = Date.now() - host.lastTypedAt < (options.recentMs ?? RECENT_MS);
		let focused = !recent;
		let tallest = 0;
		let finished = false;
		let view: AboveEditorView | undefined;
		let redraw = (): void => {};

		shut = () => close(undefined);
		const close = (value: AboveEditorResult<T> | undefined): void => {
			if (finished) return;
			finished = true;
			host.active = undefined;
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
					redraw,
					theme,
				});
				const drawn = view;
				return {
					invalidate(): void {},
					render(width: number): string[] {
						const lines = drawn.render(Math.max(1, frameInner(width)));
						// The row grows and never shrinks: a shorter step is padded to the tallest drawn
						// so far, so the editor under it does not move.
						tallest = Math.max(tallest, lines.length);
						const body = [...lines, ...Array.from({ length: tallest - lines.length }, () => "")];
						const chrome = drawn.chrome?.();
						const own = chrome?.keys ?? [];
						return frame(
							theme,
							width,
							body.map((text, index) => ({ text, selected: index === chrome?.selected })),
							{
								title: chrome?.title ?? options.title ?? "",
								status: chrome?.status,
								keys: [
									...own,
									...(options.escape === "view" || own.length > 0
										? []
										: [["esc", "close"] as [string, string]]),
									[ABOVE_EDITOR_FOCUS_KEY, "editor"],
								],
								border: focused ? "accent" : "border",
							},
						);
					},
					handleInput(data: string): void {
						drawn.handleInput(data);
					},
				};
			},
			{ placement: "aboveEditor" },
		);

		host.active = { focused: () => focused };
		stop = ui.onTerminalInput((data) => {
			if (finished) return undefined;
			// A terminal that reports key releases would type every letter twice.
			if (isKeyRelease(data)) return focused ? { consume: true } : undefined;
			if (matchesKey(data, ABOVE_EDITOR_FOCUS_KEY as KeyId)) {
				focused = !focused;
				host.lastTypedAt = focused ? 0 : Date.now();
				redraw();
				return { consume: true };
			}
			// The key never reaches the editor without the editor having the focus.
			if (!focused) {
				host.lastTypedAt = Date.now();
				return undefined;
			}
			if (options.escape !== "view" && matchesKey(data, "escape")) {
				close(undefined);
				return { consume: true };
			}
			view?.handleInput(data);
			redraw();
			return { consume: true };
		});
	};

	const host = hostOf(ui);
	// A view that throws while it is built reaches the caller, and the row goes free for the next one.
	const turn = host.queue.then(run).catch((error: unknown) => {
		host.active = undefined;
		stop();
		fail(error);
	});
	host.queue = result.then(
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

/** Whether this host can draw above the editor and keep the editor under the dialog. */
export function canOpenAboveEditor(ui: ExtensionUIContext): boolean {
	const parts = ui as Partial<ExtensionUIContext>;
	return (
		typeof parts.setWidget === "function" &&
		typeof parts.onTerminalInput === "function" &&
		typeof parts.getEditorText === "function"
	);
}

const KEY = "pi-kit:above-editor";

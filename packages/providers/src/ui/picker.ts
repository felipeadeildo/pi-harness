// Our dialogs wear the same frame as the rest of the harness. A host that cannot draw a component,
// like RPC, falls back to pi's own select.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	SelectList,
	type SelectListTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const MAX_VISIBLE = 10;

/** Asks for one of the options, in a frame, and returns undefined when the answer is cancelled. */
export async function pick(
	ctx: ExtensionContext,
	title: string,
	options: readonly string[],
	dialog: { signal?: AbortSignal } = {},
): Promise<string | undefined> {
	if (options.length === 0) return undefined;
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
		return await ctx.ui.select(title, [...options], dialog);
	}
	return await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
		let finished = false;
		const finish = (value: string | undefined) => {
			if (finished) return;
			finished = true;
			done(value);
		};
		dialog.signal?.addEventListener("abort", () => finish(undefined), { once: true });
		return new FramedSelect(tui, theme, title, options, finish);
	});
}

/** A select list with our frame around it. */
export class FramedSelect implements Component {
	private readonly list: SelectList;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly title: string,
		options: readonly string[],
		private readonly done: (value: string | undefined) => void,
		listTheme: SelectListTheme = getSelectListTheme(),
	) {
		this.list = new SelectList(
			options.map((label) => ({ value: label, label })),
			Math.max(1, Math.min(MAX_VISIBLE, options.length)),
			listTheme,
		);
		this.list.onSelect = (item) => this.done(item.value);
		this.list.onCancel = () => this.done(undefined);
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
		this.tui.requestRender();
	}

	invalidate(): void {
		this.list.invalidate();
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		return [
			this.top(width),
			...this.list.render(inner).map((row) => this.row(row, inner)),
			this.row("", inner),
			this.row(this.hint(), inner),
			this.bottom(width),
		];
	}

	private top(width: number): string {
		const room = Math.max(0, width - 5);
		const label = this.theme.fg("accent", truncateToWidth(this.title, Math.max(0, room - 3), "…"));
		const dashes = Math.max(0, room - visibleWidth(label));
		return `${this.border("╭─ ")}${label}${this.border(` ${"─".repeat(dashes)}╮`)}`;
	}

	private row(text: string, inner: number): string {
		const clipped = truncateToWidth(text, inner);
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
		return `${this.border("│")} ${clipped}${pad} ${this.border("│")}`;
	}

	private bottom(width: number): string {
		return this.border(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
	}

	private hint(): string {
		return [
			`${this.theme.fg("muted", "↑↓")} ${this.theme.fg("dim", "move")}`,
			`${this.theme.fg("muted", "enter")} ${this.theme.fg("dim", "select")}`,
			`${this.theme.fg("muted", "esc")} ${this.theme.fg("dim", "cancel")}`,
		].join("   ");
	}

	private border(text: string): string {
		return this.theme.fg("border", text);
	}
}

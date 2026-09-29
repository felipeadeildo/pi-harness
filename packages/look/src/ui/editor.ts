// The editor, framed. Pi's editor draws a rule above and below the text; this one draws a box, writes
// four slots into its borders, puts the working spinner in the top-left corner, and a prompt glyph in
// front of the first line. Typing, history, autocomplete and every app key stay pi's: the class only
// changes what the lines look like, and shifts mouse clicks by the width of the frame.
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
	type EditorTheme,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { Piece } from "../render/fit.ts";
import { BOXES, border } from "../render/frame.ts";
import type { CursorStyle } from "../settings.ts";
import { type Screen, type SlotName, slotPieces } from "./screen.ts";

type WorkingIndicator = Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

/** Pi calls the border hooks inside its render; these stand in for the lines this class draws. */
const TOP = "\u0000look:top\u0000";
const BOTTOM = "\u0000look:bottom\u0000";
// oxlint-disable-next-line no-control-regex -- pi's software cursor is an escape sequence
const INVERTED_CELL = /\x1b\[7m([\s\S]*?)\x1b\[0m/;
/** Below this the frame is noise, so pi's plain editor draws instead. */
const MIN_WIDTH = 24;
/** The spinner always gets this much of the top border, enough for "⠋ Thinking". */
const LEAD_MIN = 10;

const CURSOR_SEQUENCES: Record<CursorStyle, string> = {
	block: "\x1b[0 q",
	bar: "\x1b[6 q",
	underline: "\x1b[4 q",
};

export class LookEditor extends CustomEditor {
	readonly #screen: Screen;
	#indicator: WorkingIndicator;
	#framing = false;
	#hiddenAbove = 0;
	#hiddenBelow = 0;
	/** Columns the frame takes on the left, for mouse clicks. */
	#inset = 0;
	#outset = 0;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		screen: Screen,
		options: { autocompleteMaxVisible?: number } = {},
	) {
		super(tui, theme, keybindings, { ...options, paddingX: 0, embedWorkingStatus: true });
		this.#screen = screen;
	}

	/** The frame owns the horizontal inset, so pi's padding setting would double it. */
	override setPaddingX(_padding: number): void {
		super.setPaddingX(0);
	}

	override setWorkingStatusIndicator(indicator: WorkingIndicator): void {
		super.setWorkingStatusIndicator(indicator);
		this.#indicator = indicator;
		this.tui.requestRender();
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.#inset === 0 && this.#outset === 0) return super.handleMouse(event);
		return super.handleMouse({
			...event,
			x: event.x - this.#inset,
			width: Math.max(1, event.width - this.#inset - this.#outset),
		});
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (!this.#framing) return super.renderTopBorder(width, hiddenLineCount);
		this.#hiddenAbove = hiddenLineCount;
		return TOP;
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (!this.#framing) return super.renderBottomBorder(width, hiddenLineCount);
		this.#hiddenBelow = hiddenLineCount;
		return BOTTOM;
	}

	override render(width: number): string[] {
		const style = this.#screen.frameStyle();
		if (style === "off" || width < MIN_WIDTH) {
			this.#inset = 0;
			this.#outset = 0;
			return super.render(width);
		}

		const box = BOXES[style];
		const sides = box.vertical === "" ? 0 : 2;
		const glyphs = this.#screen.glyphs();
		const prompt = this.#screen.prompt() ? `${glyphs.prompt} ` : "";
		const promptWidth = visibleWidth(prompt);
		this.#inset = sides + promptWidth;
		this.#outset = sides;
		const inner = Math.max(1, width - this.#inset - this.#outset);

		const cursor = this.#screen.cursor();
		// Pi puts its own cursor setting back after a reload, which would hide a bar cursor.
		if (cursor !== "block" && !this.tui.getShowHardwareCursor()) applyCursor(this.tui, cursor);

		this.#framing = true;
		let lines: string[];
		try {
			lines = super.render(inner);
		} finally {
			this.#framing = false;
		}

		const paint = this.#screen.paint((text) => this.borderColor(text));
		const snapshot = this.#screen.snapshot();
		const separator = paint.dim(this.#screen.separator());
		const pieces = (name: SlotName): Piece[] => slotPieces(this.#screen, name, snapshot, paint);
		const scroll = (arrow: string, hidden: number): Piece[] =>
			hidden > 0 ? [{ text: paint.dim(`${arrow} ${hidden} more`), priority: 1000 }] : [];
		const options = { box, paint: paint.frame, separator, ellipsis: glyphs.ellipsis };

		const left = style === "line" ? "" : `${paint.frame(box.vertical)} `;
		const right = style === "line" ? "" : ` ${paint.frame(box.vertical)}`;
		const gutter = " ".repeat(promptWidth);
		const result: string[] = [];
		let inside = false;
		let first = true;

		for (const line of lines) {
			if (line === TOP) {
				const lead =
					this.#indicator === undefined ? undefined : (budget: number) => this.#lead(budget);
				result.push(
					border(
						width,
						pieces("topLeft"),
						[...scroll("↑", this.#hiddenAbove), ...pieces("topRight")],
						{
							...options,
							edge: "top",
							lead,
							leadMin: LEAD_MIN,
						},
					),
				);
				inside = true;
			} else if (line === BOTTOM) {
				result.push(
					border(
						width,
						pieces("bottomLeft"),
						[...scroll("↓", this.#hiddenBelow), ...pieces("bottomRight")],
						{ ...options, edge: "bottom" },
					),
				);
				inside = false;
			} else if (inside) {
				const lead = first ? this.borderColor(prompt) : gutter;
				first = false;
				const text = cursor === "block" ? line : withoutSoftwareCursor(line);
				result.push(`${left}${lead}${fill(text, inner)}${right}`);
			} else {
				// The autocomplete list, lined up with the text so clicks land where they look.
				result.push(`${" ".repeat(this.#inset)}${line}`);
			}
		}

		return result.map((line) => truncateToWidth(line, width, ""));
	}

	/** The spinner and its message, in the room the slots left. Just the spinner when it is tight. */
	#lead(budget: number): string | undefined {
		const indicator = this.#indicator;
		if (indicator === undefined) return undefined;
		const full = indicator.renderInBorder(budget);
		if (visibleWidth(full) > 0 && visibleWidth(full) <= budget) return full;
		return indicator.renderSpinnerInBorder(budget);
	}
}

/**
 * Pi draws its cursor as an inverted cell. With the terminal's own cursor showing, that would be two
 * cursors, so the inversion goes and the character stays.
 */
function withoutSoftwareCursor(line: string): string {
	return line.replace(INVERTED_CELL, "$1");
}

/** Pads a content line to the inner width, so the right rail stays straight. */
function fill(line: string, width: number): string {
	const clipped = truncateToWidth(line, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

/** Sets the terminal cursor shape. Pi draws its own block cursor, so the others need the hardware one. */
export function applyCursor(tui: TUI, style: CursorStyle): void {
	if (style !== "block") tui.setShowHardwareCursor(true);
	tui.terminal.write(CURSOR_SEQUENCES[style]);
}

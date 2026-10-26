// The frame a transcript entry wears. See DESIGN.md.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { CUT, LINE } from "./glyphs.ts";

/** Both sides and a space inside each. */
export const CHANGES_X = 4;
/** Drawn as a rule across, as between a call and what it printed. */
export const CHANGES_CUT = "\u0000cut";

export interface EntryFrame {
	top?: string;
	topRight?: string;
	bottom?: string;
	bottomRight?: string;
	color?: ThemeColor;
	/** Something that has not happened yet, such as a message waiting to be sent. */
	dashed?: boolean;
	/** Pi's own blocks bring their own column, so they take 0. */
	pad?: 0 | 1;
}

const SOLID = { h: LINE.h, v: LINE.v };
const DASHED = { h: LINE.hDashed, v: LINE.vDashed };

/** `CHANGES_X` columns narrower than `width` (two with no pad). */
export function entryFrame(
	body: readonly string[],
	width: number,
	theme: Theme,
	frame: EntryFrame = {},
): string[] {
	const lines = frame.dashed ? DASHED : SOLID;
	const paint = (text: string) => theme.fg(frame.color ?? "border", text);
	const pad = " ".repeat(frame.pad ?? 1);
	const inner = Math.max(1, width - 2 - pad.length * 2);
	const edge = (corners: [string, string], left?: string, right?: string) => {
		const end = (right ? ` ${right} ` : "") + paint(lines.h + corners[1]);
		// A long label is cut, never the corner.
		const room = Math.max(0, width - 2 - visibleWidth(end) - 2);
		const label = left ? ` ${truncateToWidth(left, room, CUT)} ` : "";
		const start = paint(corners[0] + lines.h) + label;
		const fill = Math.max(0, width - visibleWidth(start) - visibleWidth(end));
		const rule = start + paint(lines.h.repeat(fill)) + end;
		return fill === 0 ? truncateToWidth(rule, width, "") : rule;
	};
	const side = paint(lines.v);
	return [
		edge([LINE.topLeft, LINE.topRight], frame.top, frame.topRight),
		...body.map((line) => {
			if (line === CHANGES_CUT)
				return paint(LINE.teeLeft + LINE.h.repeat(width - 2) + LINE.teeRight);
			const cells = visibleWidth(line);
			const cut = cells > inner ? truncateToWidth(line, inner, "") : line;
			const shown = cells > inner ? visibleWidth(cut) : cells;
			return `${side}${pad}${cut}${" ".repeat(Math.max(0, inner - shown))}${pad}${side}`;
		}),
		edge([LINE.bottomLeft, LINE.bottomRight], frame.bottom, frame.bottomRight),
	];
}

/** The transcript redraws every entry on each keystroke, so an entry draws once per width. */
export function drawnByWidth(draw: (width: number) => string[]): Component {
	let drawn: { width: number; lines: string[] } | undefined;
	return {
		render(width) {
			if (drawn?.width !== width) drawn = { width, lines: draw(width) };
			return drawn.lines;
		},
		invalidate() {
			drawn = undefined;
		},
	};
}

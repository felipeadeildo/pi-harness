// Borders with something written in them: `╭─ left ────── right ─╮`. The frame is the one place
// that knows the box characters, so a new style is one entry here.
import { visibleWidth } from "@earendil-works/pi-tui";

import { type FitOptions, fitRegions, type Piece } from "./fit.ts";

export type FrameStyle = "rounded" | "square" | "heavy" | "line";

export interface BoxChars {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
}

export const BOXES: Record<FrameStyle, BoxChars> = {
	rounded: {
		topLeft: "╭",
		topRight: "╮",
		bottomLeft: "╰",
		bottomRight: "╯",
		horizontal: "─",
		vertical: "│",
	},
	square: {
		topLeft: "┌",
		topRight: "┐",
		bottomLeft: "└",
		bottomRight: "┘",
		horizontal: "─",
		vertical: "│",
	},
	heavy: {
		topLeft: "┏",
		topRight: "┓",
		bottomLeft: "┗",
		bottomRight: "┛",
		horizontal: "━",
		vertical: "┃",
	},
	// Only the horizontal rules, the way pi draws its editor, with the data written into them.
	line: {
		topLeft: "─",
		topRight: "─",
		bottomLeft: "─",
		bottomRight: "─",
		horizontal: "─",
		vertical: "",
	},
};

export interface BorderOptions extends Pick<FitOptions, "separator" | "ellipsis"> {
	box: BoxChars;
	edge: "top" | "bottom";
	/** Paints the rule and the corners. */
	paint: (text: string) => string;
	/**
	 * Text that follows the left pieces and takes whatever room is left, like the working spinner.
	 * It goes after them because it changes width all the time, and the pieces must not move.
	 */
	lead?: ((budget: number) => string | undefined) | undefined;
	/** Room kept for the lead, so the pieces never squeeze it out. */
	leadMin?: number;
}

/** Corners, one rule cell each side, and one rule cell between the two regions at least. */
const FIXED = 5;
/** A space on each side of a region's text. */
const PADDING = 2;

/** One border line of exactly `width` columns, with both regions fitted into it. */
export function border(
	width: number,
	left: readonly Piece[],
	right: readonly Piece[],
	options: BorderOptions,
): string {
	const { box, paint } = options;
	const [start, end] =
		options.edge === "top" ? [box.topLeft, box.topRight] : [box.bottomLeft, box.bottomRight];
	if (width < FIXED) return paint(box.horizontal.repeat(Math.max(0, width)));

	const separatorWidth = visibleWidth(options.separator);
	const reserve =
		options.lead === undefined ? 0 : (options.leadMin ?? 1) + separatorWidth + PADDING;
	const budget = width - FIXED - reserve;

	const [fittedLeft = "", fittedRight = ""] =
		budget > 0
			? fitRegions([left, right], budget, {
					separator: options.separator,
					regionOverhead: PADDING,
					ellipsis: options.ellipsis,
				})
			: ["", ""];

	const rightCell = fittedRight === "" ? "" : ` ${fittedRight} `;
	let leftText = fittedLeft;
	if (options.lead !== undefined) {
		const used =
			visibleWidth(rightCell) + (fittedLeft === "" ? 0 : visibleWidth(fittedLeft) + separatorWidth);
		const lead = options.lead(Math.max(1, width - FIXED - PADDING - used));
		if (lead !== undefined && lead !== "")
			leftText = fittedLeft === "" ? lead : `${fittedLeft}${options.separator}${lead}`;
	}
	const leftCell = leftText === "" ? "" : ` ${leftText} `;
	const fill = Math.max(1, width - 4 - visibleWidth(leftCell) - visibleWidth(rightCell));

	return (
		paint(`${start}${box.horizontal}`) +
		leftCell +
		paint(box.horizontal.repeat(fill)) +
		rightCell +
		paint(`${box.horizontal}${end}`)
	);
}

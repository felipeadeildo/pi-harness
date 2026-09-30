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
	paint: (text: string) => string;
	lead?: ((budget: number) => string | undefined) | undefined;
	leadMin?: number;
}

const FIXED = 5;
const PADDING = 2;

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

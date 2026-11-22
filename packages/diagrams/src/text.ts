// Where the terminal shows no images, the diagram is Unicode art, drawn as pi draws it on its own.
import { createRequire } from "node:module";

import type * as Lovely from "lovely-mermaid";

import type { ThemeColors } from "./colors.ts";

// Loaded on the first diagram a terminal without images draws.
let lovely: typeof Lovely | undefined;

/** Throws when the art cannot be drawn or is wider than the column. */
export function asciiDiagram(
	source: string,
	theme: ThemeColors,
	width: number,
	hyperlinks: boolean,
): string {
	lovely ??= createRequire(import.meta.url)("lovely-mermaid") as typeof Lovely;
	const { render, toAnsi } = lovely;
	const art = render(source);
	if (!art) throw new Error("this kind of diagram has no text form");
	if (art.width > width) throw new Error(`it needs ${art.width} columns and has ${width}`);
	if (art.warnings.length > 0) throw new Error(art.warnings[0]);
	const sgr = (color: Parameters<ThemeColors["getFgAnsi"]>[0]) =>
		theme.getFgAnsi(color).slice(2, -1);
	const lines = toAnsi(
		{
			...art,
			// A link covers the label's text, never the whole box.
			styled: art.styled.map((row) =>
				row.map((span) => {
					if (span.href === undefined || (hyperlinks && span.role === "text")) return span;
					const { href: _href, ...unlinked } = span;
					return unlinked;
				}),
			),
		},
		{
			border: sgr("borderMuted"),
			text: sgr("text"),
			edge: sgr("accent"),
			edgeLabel: sgr("text"),
			title: `1;${sgr("accent")}`,
		},
	);
	return `${lines.map(codeSpan).join("  \n")}\n`;
}

/**
 * One row as inline code, so Markdown keeps its spacing and box-drawing characters. The fence is
 * longer than any run of backticks in the row, and an empty row keeps its height with a
 * non-breaking space.
 */
export function codeSpan(line: string): string {
	const content = line || "\u00a0";
	const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
	const fence = "`".repeat(longest + 1);
	const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
	return `${fence}${padding}${content}${padding}${fence}`;
}

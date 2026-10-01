// Ported from rpiv-ask-user-question.
import {
	Markdown,
	type MarkdownTheme,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const SIDE_BY_SIDE_WIDTH = 100;
export const COLUMN_GAP = 2;
const MIN_LEFT = 30;
const MIN_BOX_CONTENT = 40;
const ROWS_BESIDE = 20;
const ROWS_BELOW = 15;

const FENCE = /^`{3}/;
// oxlint-disable-next-line no-control-regex -- it matches the escape codes Markdown writes
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

export type Layout = "beside" | "below";

export function layoutFor(width: number): Layout {
	return width >= SIDE_BY_SIDE_WIDTH ? "beside" : "below";
}

/** Wide enough for the longest label, and never more than half the width. */
export function leftWidth(labels: readonly string[], width: number): number {
	const longest = Math.max(0, ...labels.map((label) => visibleWidth(label)));
	// The pointer, number, checkbox and answered mark.
	const wanted = longest + 12;
	return Math.max(MIN_LEFT, Math.min(wanted, Math.floor(width / 2)));
}

export class PreviewCache {
	private readonly rendered = new Map<string, string[]>();

	constructor(private readonly theme: MarkdownTheme) {}

	lines(text: string, width: number): string[] {
		const key = `${width}\u0000${text}`;
		let lines = this.rendered.get(key);
		if (lines === undefined) {
			// pi-tui prints the fence lines of code blocks.
			lines = new Markdown(text, 0, 0, this.theme)
				.render(width)
				.filter((line) => !FENCE.test(line.replace(ANSI, "")));
			this.rendered.set(key, lines);
		}
		return lines;
	}

	invalidate(): void {
		this.rendered.clear();
	}
}

export function previewBox(
	cache: PreviewCache,
	text: string,
	width: number,
	layout: Layout,
	paint: (text: string) => string,
): string[] {
	const maxContent = Math.max(1, width - 4);
	const all = cache.lines(text, maxContent);
	const budget = (layout === "beside" ? ROWS_BESIDE : ROWS_BELOW) - 2;
	const shown = all.slice(0, budget);
	const hidden = all.length - shown.length;

	let content = Math.min(MIN_BOX_CONTENT, maxContent);
	for (const line of shown) content = Math.max(content, visibleWidth(line.replace(/\s+$/, "")));
	content = Math.min(content, maxContent);

	const dashes = content + 2;
	const out = [paint(`\u250c${"\u2500".repeat(dashes)}\u2510`)];
	for (const line of shown) {
		const cell = truncateToWidth(line, content, "", true);
		out.push(`${paint("\u2502")} ${cell} ${paint("\u2502")}`);
	}
	out.push(paint(`\u2514${bottomRun(dashes, hidden)}\u2518`));
	return out;
}

function bottomRun(dashes: number, hidden: number): string {
	if (hidden <= 0) return "\u2500".repeat(dashes);
	const tag = ` ${hidden} more lines `;
	if (tag.length >= dashes) return "\u2500".repeat(dashes);
	const left = Math.floor((dashes - tag.length) / 2);
	return `${"\u2500".repeat(left)}${tag}${"\u2500".repeat(dashes - left - tag.length)}`;
}

export function besideColumns(
	left: readonly string[],
	right: readonly string[],
	leftCols: number,
	width: number,
): string[] {
	const rows = Math.max(left.length, right.length);
	const gap = " ".repeat(COLUMN_GAP);
	const out: string[] = [];
	for (let row = 0; row < rows; row++) {
		const cell = truncateToWidth(left[row] ?? "", leftCols, "");
		const pad = " ".repeat(Math.max(0, leftCols - visibleWidth(cell)));
		out.push(truncateToWidth(`${cell}${pad}${gap}${right[row] ?? ""}`, width, ""));
	}
	return out;
}

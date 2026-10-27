// The frame every harness dialog wears. No surface paints a background. See DESIGN.md.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { CUT, GLYPH, LINE } from "./glyphs.ts";

export const FRAME_PAD = 2;
/** Both sides and their padding. */
export const FRAME_X = 2 + FRAME_PAD * 2;
export const FRAME_Y = 2;

export const POINTER = GLYPH.pointer;

export type KeyHint = readonly [key: string, action: string];

/** The chosen row marks itself with `pointer`; the frame draws every row the same. */
export type FrameLine = string;

export interface FrameOptions extends BottomOptions {
	title: string;
	/** Counts, a step, how far along. */
	status?: string;
	tabs?: FrameTabs;
}

export interface FrameTabs {
	titles: readonly string[];
	current: number;
}

export interface BottomOptions {
	/** Only the ones that do something right now. */
	keys?: readonly KeyHint[];
	/** What it cost, where you are. */
	footnote?: string;
	/** Columns into the text, meeting both edges. */
	split?: number;
	/** A full-screen view draws them quieter than a dialog. */
	border?: ThemeColor;
}

export function frameInner(width: number): number {
	return Math.max(1, width - FRAME_X);
}

export function frame(
	theme: Theme,
	width: number,
	body: readonly FrameLine[],
	options: FrameOptions,
): string[] {
	const title = options.title === "" ? "" : theme.bold(theme.fg("accent", options.title));
	const column = junction(options.split, LINE.teeTop);
	const { tabs } = options;
	const border = options.border ?? "border";
	const top = edge(
		theme,
		border,
		width,
		LINE.topLeft,
		LINE.topRight,
		title,
		options.status ?? "",
		tabs === undefined ? column : undefined,
	);
	const head =
		tabs === undefined
			? []
			: [tabsRow(theme, border, width, tabs), divider(theme, border, width, column)];
	const rows = body.map((line) => row(theme, border, width, line));
	return [top, ...head, ...rows, frameBottom(theme, width, options)];
}

/** The tabs start one cell into the padding, so each tab's name lines up with the body under it. */
function tabsRow(theme: Theme, border: ThemeColor, width: number, tabs: FrameTabs): string {
	const inner = frameInner(width) + 2;
	const line = truncateToWidth(tabsLine(theme, tabs, inner), inner, CUT);
	const fill = " ".repeat(Math.max(0, inner - visibleWidth(line)));
	const side = theme.fg(border, LINE.v);
	const pad = " ".repeat(FRAME_PAD - 1);
	return `${side}${pad}${line}${fill}${pad}${side}`;
}

/**
 * The current tab sits on the selection color, so it reads as chosen in any theme. When they do not
 * fit, the tabs before the current one give way first.
 */
function tabsLine(theme: Theme, tabs: FrameTabs, inner: number): string {
	const gap = " ";
	const drawn = tabs.titles.map((title, index) =>
		index === tabs.current
			? theme.bg("selectedBg", theme.bold(` ${theme.fg("accent", title)} `))
			: theme.fg("muted", ` ${title} `),
	);
	const more = theme.fg("dim", GLYPH.ellipsisAcross);
	let start = 0;
	const line = () => [...(start > 0 ? [more] : []), ...drawn.slice(start)].join(gap);
	while (start < tabs.current && visibleWidth(line()) > inner) start++;
	return line();
}

function divider(
	theme: Theme,
	border: ThemeColor,
	width: number,
	column: Junction | undefined,
): string {
	const span = Math.max(0, width - 2);
	const cells: string[] = Array.from({ length: span }, () => LINE.h);
	if (column !== undefined && column.at - 1 < span) cells[column.at - 1] = column.char;
	return theme.fg(border, `${LINE.teeLeft}${cells.join("")}${LINE.teeRight}`);
}

export function frameBottom(theme: Theme, width: number, options: BottomOptions = {}): string {
	const keys = options.keys ?? [];
	// The keys sit on whichever side of the column holds them; when neither does but the whole edge
	// would, the column stops short of it.
	const wanted = visibleWidth(keyHints(theme, keys));
	const column = junction(options.split, LINE.teeBottom);
	const before = column === undefined ? width - 6 : column.at - 4;
	const after = column === undefined ? 0 : width - 6 - (column.at + 1);
	const fits = wanted <= before || wanted <= after;
	const cross = !fits && wanted <= width - 6 ? undefined : column;
	const room = cross === undefined ? width - 6 : Math.max(before, after);
	const hints = keyHints(theme, fitKeys(theme, keys, room));
	const footnote = options.footnote ?? "";
	const note = visibleWidth(hints) + visibleWidth(footnote) + 3 <= room ? footnote : "";
	const border = options.border ?? "border";
	return edge(theme, border, width, LINE.bottomLeft, LINE.bottomRight, hints, note, cross);
}

/** Whole keys only; the last one, the way out, always shows. */
function fitKeys(theme: Theme, keys: readonly KeyHint[], room: number): KeyHint[] {
	const kept = [...keys];
	while (kept.length > 1 && visibleWidth(keyHints(theme, kept)) > room)
		kept.splice(kept.length - 2, 1);
	return kept;
}

function row(theme: Theme, border: ThemeColor, width: number, text: string): string {
	const inner = frameInner(width);
	const cells = visibleWidth(text);
	const clipped = cells > inner ? truncateToWidth(text, inner, CUT) : text;
	const shown = cells > inner ? visibleWidth(clipped) : cells;
	const fill = " ".repeat(Math.max(0, inner - shown));
	const side = theme.fg(border, LINE.v);
	return `${side}${" ".repeat(FRAME_PAD)}${clipped}${fill}${" ".repeat(FRAME_PAD)}${side}`;
}

export function rule(theme: Theme, width: number, note = ""): string {
	const line = (count: number) => theme.fg("borderMuted", LINE.h.repeat(Math.max(0, count)));
	if (note === "") return line(width);
	return `${line(width - visibleWidth(note) - 1)} ${note}`;
}

function keyHints(theme: Theme, keys: readonly KeyHint[]): string {
	return keys
		.map(([key, action]) => `${theme.fg("muted", key)} ${theme.fg("dim", action)}`)
		.join("   ");
}

export function pointer(theme: Theme, selected: boolean, active = true): string {
	if (!selected) return "  ";
	return `${theme.fg(active ? "accent" : "dim", POINTER)} `;
}

interface Junction {
	at: number;
	char: string;
}

function junction(split: number | undefined, char: string): Junction | undefined {
	return split === undefined ? undefined : { at: FRAME_PAD + split + 1, char };
}

function edge(
	theme: Theme,
	color: ThemeColor,
	width: number,
	left: string,
	right: string,
	label: string,
	note: string,
	cross?: Junction,
): string {
	const border = (text: string) => theme.fg(color, text);
	const span = Math.max(0, width - 2);
	const at = cross === undefined || cross.at - 1 >= span ? undefined : cross.at - 1;
	const head = label === "" ? "" : ` ${label} `;
	const before = at === undefined || visibleWidth(head) + 2 <= at;
	const start = before ? 1 : (at ?? 0) + 2;
	const end = before && at !== undefined && note === "" ? at : span - 1;
	const fittedHead = truncateToWidth(head, Math.max(0, end - start), "... ");
	const tail = note === "" ? "" : ` ${note} `;
	const tailStart = span - 1 - visibleWidth(tail);
	const tailFits =
		tail !== "" &&
		tailStart >= start + visibleWidth(fittedHead) &&
		(at === undefined || tailStart > at);

	const cells: string[] = Array.from({ length: span }, () => border(LINE.h));
	if (at !== undefined) cells[at] = border(cross?.char ?? LINE.h);
	const place = (text: string, from: number) => {
		const size = visibleWidth(text);
		if (size === 0) return;
		cells[from] = text;
		for (let index = from + 1; index < from + size; index++) cells[index] = "";
	};
	place(fittedHead, start);
	if (tailFits) place(tail, tailStart);
	return `${border(left)}${cells.join("")}${border(right)}`;
}

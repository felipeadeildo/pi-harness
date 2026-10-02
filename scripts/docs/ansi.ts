// Reads the escape codes a component writes, so the docs can show it as text or as an image.
import { visibleWidth } from "@earendil-works/pi-tui";

const ESC = "\x1b";

export interface Style {
	fg: string | undefined;
	bg: string | undefined;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	inverse: boolean;
}

export interface Cell {
	text: string;
	width: number;
	style: Style;
}

const BASIC = [
	"#000000",
	"#cc6666",
	"#b5bd68",
	"#f0c674",
	"#81a2be",
	"#b294bb",
	"#8abeb7",
	"#c5c8c6",
	"#666666",
	"#d54e53",
	"#b9ca4a",
	"#e7c547",
	"#7aa6da",
	"#c397d8",
	"#70c0b1",
	"#eaeaea",
];

function hex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((part) => Math.max(0, Math.min(255, part)).toString(16).padStart(2, "0")).join("")}`;
}

/** One channel of a 6x6x6 cube colour. */
function cubeStep(value: number): number {
	return value === 0 ? 0 : 55 + value * 40;
}

function indexed(code: number): string {
	if (code < 16) return BASIC[code] ?? "#ffffff";
	if (code >= 232) {
		const level = 8 + (code - 232) * 10;
		return hex(level, level, level);
	}
	const n = code - 16;
	return hex(cubeStep(Math.floor(n / 36)), cubeStep(Math.floor(n / 6) % 6), cubeStep(n % 6));
}

const PLAIN: Style = {
	fg: undefined,
	bg: undefined,
	bold: false,
	dim: false,
	italic: false,
	underline: false,
	inverse: false,
};

function applyColor(params: number[], at: number, style: Style, slot: "fg" | "bg"): number {
	const kind = params[at + 1];
	if (kind === 5) {
		style[slot] = indexed(params[at + 2] ?? 0);
		return at + 2;
	}
	if (kind === 2) {
		style[slot] = hex(params[at + 2] ?? 0, params[at + 3] ?? 0, params[at + 4] ?? 0);
		return at + 4;
	}
	return at;
}

function applySgr(params: number[], style: Style): Style {
	const next = { ...style };
	for (let at = 0; at < params.length; at++) {
		const code = params[at] ?? 0;
		if (code === 0) Object.assign(next, PLAIN);
		else if (code === 1) next.bold = true;
		else if (code === 2) next.dim = true;
		else if (code === 3) next.italic = true;
		else if (code === 4) next.underline = true;
		else if (code === 7) next.inverse = true;
		else if (code === 22) {
			next.bold = false;
			next.dim = false;
		} else if (code === 23) next.italic = false;
		else if (code === 24) next.underline = false;
		else if (code === 27) next.inverse = false;
		else if (code === 39) next.fg = undefined;
		else if (code === 49) next.bg = undefined;
		else if (code >= 30 && code <= 37) next.fg = indexed(code - 30);
		else if (code >= 90 && code <= 97) next.fg = indexed(code - 90 + 8);
		else if (code >= 40 && code <= 47) next.bg = indexed(code - 40);
		else if (code >= 100 && code <= 107) next.bg = indexed(code - 100 + 8);
		else if (code === 38) at = applyColor(params, at, next, "fg");
		else if (code === 48) at = applyColor(params, at, next, "bg");
	}
	return next;
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The characters of a line with the style each one is drawn in. */
export function cellsOf(line: string): Cell[] {
	const cells: Cell[] = [];
	let style = PLAIN;
	let at = 0;
	while (at < line.length) {
		if (line.startsWith(`${ESC}[`, at)) {
			const rest = line.slice(at + 2);
			const offset = rest.search(/[@-~]/);
			const body = rest.slice(0, offset < 0 ? rest.length : offset);
			if (rest[offset] === "m")
				style = applySgr(
					body === "" ? [0] : body.split(";").map((part) => Number.parseInt(part || "0", 10)),
					style,
				);
			at += 2 + (offset < 0 ? rest.length : offset + 1);
			continue;
		}
		if (line.startsWith(`${ESC}]`, at) || line.startsWith(`${ESC}_`, at)) {
			const rest = line.slice(at);
			const bell = rest.indexOf("\x07");
			const terminator = rest.indexOf(`${ESC}\\`);
			const stops = [bell, terminator].filter((index) => index >= 0);
			at += stops.length === 0 ? rest.length : Math.min(...stops) + (stops.includes(bell) ? 1 : 2);
			continue;
		}
		const chunk = line.slice(at).split(ESC, 1)[0] ?? "";
		for (const { segment } of SEGMENTER.segment(chunk)) {
			const width = visibleWidth(segment);
			if (width > 0) cells.push({ text: segment, width, style });
		}
		at += chunk.length || 1;
	}
	return cells;
}

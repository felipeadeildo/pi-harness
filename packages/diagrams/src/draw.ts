// Mermaid text to a PNG: Pele lays it out as SVG, the theme's colors replace its CSS variables, which
// resvg does not read, and resvg rasterizes it on a canvas of whole terminal cells, so the terminal
// shows its pixels as they are instead of resampling them.
import { createRequire } from "node:module";

import type { Resvg as ResvgClass } from "@resvg/resvg-js";
import type { render as peleRender } from "pele";

import type { PeleColors } from "./colors.ts";
import { type Font, monoMeasurer } from "./font.ts";

export interface DrawOptions {
	colors: PeleColors;
	font: Font;
	fontSize: number;
	cell: { widthPx: number; heightPx: number };
	maxColumns: number;
	maxRows: number;
}

/** A PNG of exactly `columns` by `rows` cells. */
export interface Picture {
	png: Buffer;
	columns: number;
	rows: number;
}

interface Engines {
	render: typeof peleRender;
	Resvg: typeof ResvgClass;
}

// Loaded on the first diagram, so a session without one never pays for them. The Markdown transform
// is synchronous, so the load is too.
let engines: Engines | undefined;

function load(): Engines {
	if (engines) return engines;
	const require = createRequire(import.meta.url);
	const pele = require("pele") as { render: typeof peleRender };
	const resvg = require("@resvg/resvg-js") as { Resvg: typeof ResvgClass };
	engines = { render: pele.render, Resvg: resvg.Resvg };
	return engines;
}

/** Throws Pele's error when the text is not a diagram it can draw. */
export function draw(source: string, options: DrawOptions): Picture {
	const { render, Resvg } = load();
	const { family, file } = options.font;
	const { cell, fontSize } = options;
	const { svg, width, height } = render(source, {
		fontFamily: family,
		fontFamilyMono: family,
		fontSize,
		measurer: monoMeasurer,
		maxWidth: options.maxColumns * cell.widthPx,
		responsive: false,
		links: false,
		images: false,
		padding: 4,
	});
	// A diagram taller than the screen shrinks as a vector, never as pixels.
	const scale = Math.min(
		1,
		(options.maxColumns * cell.widthPx) / width,
		(options.maxRows * cell.heightPx) / height,
	);
	const columns = Math.max(1, Math.ceil((width * scale) / cell.widthPx));
	const rows = Math.max(1, Math.ceil((height * scale) / cell.heightPx));
	const canvas = onCanvas(svg, {
		widthPx: columns * cell.widthPx,
		heightPx: rows * cell.heightPx,
		scale,
		fontSize,
		family,
	});
	const image = new Resvg(withColors(canvas, options.colors), {
		font: {
			fontFiles: file ? [file] : [],
			loadSystemFonts: file === undefined,
			defaultFontFamily: family,
			monospaceFamily: family,
			sansSerifFamily: family,
		},
	}).render();
	return { png: image.asPng(), columns, rows };
}

interface Canvas {
	widthPx: number;
	heightPx: number;
	scale: number;
	fontSize: number;
	family: string;
}

/**
 * The root `<svg>` sized to the canvas, its drawing scaled and left in the top-left corner. Pele
 * sets the labels' size in a `font` shorthand resvg does not read, so they get it as attributes.
 */
function onCanvas(svg: string, canvas: Canvas): string {
	const open = svg.indexOf(">");
	const root = svg
		.slice(0, open)
		.replace(/\s(viewBox|width|height|font-size|font-family)="[^"]*"/g, "");
	const viewBox = [0, 0, canvas.widthPx / canvas.scale, canvas.heightPx / canvas.scale].join(" ");
	const family = canvas.family.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
	const attributes = `viewBox="${viewBox}" width="${canvas.widthPx}" height="${canvas.heightPx}" font-size="${canvas.fontSize}" font-family="'${family}'"`;
	return `${root} ${attributes}${svg.slice(open)}`;
}

/** Resolve every `var(--name, fallback)` in the SVG, with the theme's colors for `--pele-*`. */
export function withColors(svg: string, colors: PeleColors): string {
	const defined = new Map<string, string>();
	for (const match of svg.matchAll(/--([\w-]+)\s*:\s*([^;"]+)/g))
		defined.set(match[1] ?? "", match[2]?.trim() ?? "");
	for (const [name, value] of Object.entries(colors)) defined.set(`pele-${name}`, value);
	return substitute(svg, defined, 0);
}

const MAX_DEPTH = 8;

function substitute(text: string, defined: Map<string, string>, depth: number): string {
	if (depth > MAX_DEPTH) return text;
	let out = "";
	let at = 0;
	for (let start = text.indexOf("var(--", at); start !== -1; start = text.indexOf("var(--", at)) {
		const end = closing(text, start + 3);
		if (end === -1) break;
		const inner = text.slice(start + 4, end);
		const comma = topLevelComma(inner);
		const name = (comma === -1 ? inner : inner.slice(0, comma)).trim().slice(2);
		const fallback = comma === -1 ? "" : inner.slice(comma + 1).trim();
		out += text.slice(at, start) + substitute(defined.get(name) ?? fallback, defined, depth + 1);
		at = end + 1;
	}
	return out + text.slice(at);
}

function closing(text: string, open: number): number {
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === "(") depth++;
		else if (text[index] === ")" && --depth === 0) return index;
	}
	return -1;
}

function topLevelComma(text: string): number {
	let depth = 0;
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "(") depth++;
		else if (text[index] === ")") depth--;
		else if (text[index] === "," && depth === 0) return index;
	}
	return -1;
}

// Mermaid text to a PNG: Pele lays it out as SVG, the theme's colors replace its CSS variables, which
// resvg does not read, and resvg rasterizes it at the terminal's own cell size.
import { createRequire } from "node:module";

import type { Resvg as ResvgClass } from "@resvg/resvg-js";
import type { render as peleRender } from "pele";

import type { PeleColors } from "./colors.ts";
import { type Font, monoMeasurer } from "./font.ts";

export interface DrawOptions {
	colors: PeleColors;
	font: Font;
	fontSize: number;
	maxWidthPx: number;
}

export interface Picture {
	png: Buffer;
	width: number;
	height: number;
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
	const { svg } = render(source, {
		fontFamily: family,
		fontFamilyMono: family,
		fontSize: options.fontSize,
		measurer: monoMeasurer,
		maxWidth: options.maxWidthPx,
		responsive: false,
		links: false,
		images: false,
		padding: 4,
	});
	const image = new Resvg(withColors(svg, options.colors), {
		font: {
			fontFiles: file ? [file] : [],
			loadSystemFonts: file === undefined,
			defaultFontFamily: family,
			monospaceFamily: family,
			sansSerifFamily: family,
		},
	}).render();
	return { png: image.asPng(), width: image.width, height: image.height };
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

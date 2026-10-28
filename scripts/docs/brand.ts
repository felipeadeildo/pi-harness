// The project's icon, banner and social picture. All three draw the π from the same pixels the
// start card draws, in the same colours, so the brand cannot drift from what the terminal shows.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { colorToHex, visibleWidth } from "@earendil-works/pi-tui";

import { LINE } from "../../packages/kit/src/index.ts";
import { halfBlocks, LOGO_RAMP, PIXELS } from "../../packages/look/src/ui/header.ts";
import { toSvg } from "./svg.ts";
import { shippedTheme } from "./theme.ts";

export const REPO = "https://github.com/felipeadeildo/pi-harness";
const SITE = "https://adeildo.dev";
const INSTALL = "pi install npm:@adeildo/pi-harness";

/** The terminal's own background in every picture of the docs. */
export const DARK_GROUND = "#18181e";
const LIGHT_GROUND = "#f6f6f3";

const RAMP_TOKENS: Record<(typeof LOGO_RAMP)[number], ThemeColor> = {
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

/** One colour per row of half blocks, top to bottom, from the dark theme the start card uses. */
function rampColors(): string[] {
	const dark = shippedTheme("dark");
	return LOGO_RAMP.map((level) => colorToHex(dark.colors[RAMP_TOKENS[level]]));
}

/** The π's pixels as rectangles, `cell` wide each, from the top left of the first lit row. */
function piRects(cell: number, left: number, top: number): string[] {
	const colors = rampColors();
	const first = PIXELS.findIndex((row) => row.includes("#"));
	const rects: string[] = [];
	for (const [y, row] of PIXELS.entries()) {
		if (y < first) continue;
		// A pixel row takes the colour of the half-block row it falls in, as on the start card.
		const fill = colors[Math.floor(y / 2)] ?? colors.at(-1);
		for (const [x, pixel] of [...row].entries()) {
			if (pixel !== "#") continue;
			rects.push(
				`<rect x="${left + x * cell}" y="${top + (y - first) * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`,
			);
		}
	}
	return rects;
}

const COLUMNS = Math.max(...PIXELS.map((row) => row.length));
const ROWS = PIXELS.length - PIXELS.findIndex((row) => row.includes("#"));

/**
 * The π on the terminal's ground, with the corners of an app icon. `fill` is how much of the width
 * the π takes: an icon on a home screen wants room around it, a favicon does not.
 */
export function iconSvg(size = 512, fill = 0.6): string {
	const cell = Math.max(1, Math.floor((size * fill) / COLUMNS));
	const left = Math.round((size - COLUMNS * cell) / 2);
	const top = Math.round((size - ROWS * cell) / 2);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
		`<rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${DARK_GROUND}" shape-rendering="geometricPrecision"/>`,
		...piRects(cell, left, top),
		"</svg>",
		"",
	].join("\n");
}

/** The π alone, for a page that draws it on its own ground. */
export function markSvg(): string {
	const cell = 4;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * cell}" height="${ROWS * cell}" viewBox="0 0 ${COLUMNS * cell} ${ROWS * cell}" shape-rendering="crispEdges">`,
		...piRects(cell, 0, 0),
		"</svg>",
		"",
	].join("\n");
}

const WIDE = 86;

/** The banner as terminal lines: the π on the left, and what the harness is for on the right. */
function bannerLines(theme: Theme): string[] {
	const colors = rampColors();
	const fg = (color: ThemeColor, text: string) => theme.fg(color, text);
	const logo = halfBlocks(PIXELS).map(
		(row, index) => `\x1b[38;2;${rgb(colors[index] ?? "#ffffff")}m${row}\x1b[39m`,
	);
	const right = [
		theme.bold(fg("text", "pi-harness")),
		fg("accent", "Pi, with you in the loop."),
		"",
		fg("muted", "Approve what runs, answer what the model would guess,"),
		fg("muted", "and see what every agent is doing, on any machine of yours."),
		"",
		`${fg("dim", "$")} ${fg("text", INSTALL)}`,
	];
	const inner = WIDE - 2;
	const lines: string[] = [];
	const border = (text: string) => fg("border", text);
	const site = ` ${fg("muted", "adeildo.dev")} `;
	const before = inner - visibleWidth(site) - 1;
	lines.push(
		`${border(`${LINE.topLeft}${LINE.h.repeat(before)}`)}${site}${border(`${LINE.h}${LINE.topRight}`)}`,
	);
	lines.push(`${border(LINE.v)}${" ".repeat(inner)}${border(LINE.v)}`);
	for (let row = 0; row < right.length; row++) {
		const art = logo[row] ?? " ".repeat(14);
		const text = right[row] ?? "";
		const body = `   ${art}     ${text}`;
		lines.push(`${border(LINE.v)}${pad(body, inner)}${border(LINE.v)}`);
	}
	lines.push(`${border(LINE.v)}${" ".repeat(inner)}${border(LINE.v)}`);
	lines.push(border(`${LINE.bottomLeft}${LINE.h.repeat(inner)}${LINE.bottomRight}`));
	return lines;
}

export function bannerSvg(scheme: "dark" | "light"): string {
	const theme = shippedTheme(scheme);
	const ground = scheme === "dark" ? DARK_GROUND : LIGHT_GROUND;
	return toSvg(bannerLines(theme), {
		background: ground,
		foreground: colorToHex(theme.colors.text),
	});
}

/** GitHub's social picture, 1280 by 640: the dark banner in the middle of the terminal's ground. */
export function socialSvg(): string {
	const inner = bannerSvg("dark");
	const width = Number(/width="(\d+)"/.exec(inner)?.[1] ?? 0);
	const height = Number(/height="(\d+)"/.exec(inner)?.[1] ?? 0);
	const scale = Math.min(1200 / width, 600 / height);
	const x = Math.round((1280 - width * scale) / 2);
	const y = Math.round((640 - height * scale) / 2);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">`,
		`<rect width="1280" height="640" fill="${DARK_GROUND}"/>`,
		`<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)})">`,
		inner.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""),
		"</g>",
		"</svg>",
		"",
	].join("\n");
}

/** The banner on top of the root README: GitHub picks the picture that suits the reader's theme. */
export function bannerBlock(raw: string): string {
	return [
		`<p align="center">`,
		`  <picture>`,
		`    <source media="(prefers-color-scheme: dark)" srcset="${raw}/assets/brand/banner-dark.png">`,
		`    <img src="${raw}/assets/brand/banner-light.png" alt="pi-harness: Pi, with you in the loop. Approve what runs, answer what the model would guess, and see what every agent is doing, on any machine of yours." width="860">`,
		`  </picture>`,
		`</p>`,
	].join("\n");
}

/** The same last lines on every page. */
export function footerBlock(): string {
	return [
		`<p align="center">`,
		`  <a href="${SITE}"><img src="${SITE}/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>`,
		`  <a href="${REPO}">pi-harness</a> is made by <a href="${SITE}">adeildo.dev</a>`,
		`</p>`,
	].join("\n");
}

function rgb(hex: string): string {
	const value = Number.parseInt(hex.slice(1), 16);
	return `${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}`;
}

function pad(text: string, width: number): string {
	return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

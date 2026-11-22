// The diagram's colors come from the active pi theme, so it reads like the rest of the transcript.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { RgbColor, TerminalColors } from "@earendil-works/pi-tui";

export type ThemeColors = Pick<Theme, "getFgAnsi" | "fg">;

/** The `--pele-*` variables a diagram is drawn with, by name without the prefix. */
export type PeleColors = Record<string, string>;

const ROLES: Record<string, ThemeColor> = {
	fg: "text",
	muted: "muted",
	line: "accent",
	border: "borderMuted",
	accent: "accent",
	critical: "error",
	"series-1": "accent",
	"series-2": "syntaxString",
	"series-3": "success",
	"series-4": "error",
	"series-5": "syntaxVariable",
	"series-6": "warning",
	"series-7": "syntaxKeyword",
	"series-8": "thinkingXhigh",
};

const XTERM_BASE = [
	"#000000",
	"#800000",
	"#008000",
	"#808000",
	"#000080",
	"#800080",
	"#008080",
	"#c0c0c0",
	"#808080",
	"#ff0000",
	"#00ff00",
	"#ffff00",
	"#0000ff",
	"#ff00ff",
	"#00ffff",
	"#ffffff",
];

/**
 * Nodes and lanes keep the terminal's own background, since the harness paints none. Labels over a
 * line are cut out in the background the terminal reported, or a guess from the text's lightness.
 */
export function peleColors(theme: ThemeColors, terminal: TerminalColors = {}): PeleColors {
	const colors: PeleColors = {};
	for (const [name, role] of Object.entries(ROLES)) {
		const color = ansiToHex(theme.getFgAnsi(role));
		if (color !== undefined) colors[name] = color;
	}
	if (colors.fg === undefined && terminal.foreground) colors.fg = rgbHex(terminal.foreground);
	const dark = luminance(colors.fg ?? "#000000") > 0.5;
	colors.bg = terminal.background ? rgbHex(terminal.background) : dark ? "#000000" : "#ffffff";
	colors.surface = "transparent";
	colors["surface-alt"] = "transparent";
	return colors;
}

/** The hex of an SGR foreground: truecolor or the 256-color palette. A default color has none. */
export function ansiToHex(sgr: string): string | undefined {
	const truecolor = /\[38;2;(\d+);(\d+);(\d+)m/.exec(sgr);
	if (truecolor) return hex(Number(truecolor[1]), Number(truecolor[2]), Number(truecolor[3]));
	const indexed = /\[38;5;(\d+)m/.exec(sgr);
	if (indexed) return xterm(Number(indexed[1]));
	return undefined;
}

function xterm(index: number): string {
	if (index < 16) return XTERM_BASE[index] ?? "#ffffff";
	if (index >= 232) {
		const gray = 8 + (index - 232) * 10;
		return hex(gray, gray, gray);
	}
	const cube = index - 16;
	return hex(level(Math.floor(cube / 36)), level(Math.floor(cube / 6) % 6), level(cube % 6));
}

function level(step: number): number {
	return step === 0 ? 0 : 55 + step * 40;
}

function rgbHex(color: RgbColor): string {
	return hex(color.r, color.g, color.b);
}

function hex(red: number, green: number, blue: number): string {
	return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color: string): number {
	const value = Number.parseInt(color.slice(1), 16);
	const red = (value >> 16) & 255;
	const green = (value >> 8) & 255;
	const blue = value & 255;
	return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

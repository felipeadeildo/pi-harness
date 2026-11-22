// A diagram is drawn in one monospace font, measured as the terminal measures its cells: every column
// is the same width, so the labels Pele sizes are the labels resvg draws.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { visibleWidth } from "@earendil-works/pi-tui";

export interface Font {
	family: string;
	/** Absent when no file was found, and resvg then loads every system font. */
	file?: string;
}

/** The advance of a monospace glyph, in ems. Most coding fonts sit within 2% of it. */
export const MONO_ADVANCE = 0.6;

const KNOWN: readonly Font[] = [
	{ family: "Menlo", file: "/System/Library/Fonts/Menlo.ttc" },
	{ family: "Consolas", file: "C:\\Windows\\Fonts\\consola.ttf" },
	{ family: "DejaVu Sans Mono", file: "/usr/share/fonts/TTF/DejaVuSansMono.ttf" },
	{ family: "DejaVu Sans Mono", file: "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf" },
];

let found: Font | undefined;

export function monoFont(): Font {
	found ??= fontconfig() ??
		KNOWN.find((font) => font.file && existsSync(font.file)) ?? {
			family: "monospace",
		};
	return found;
}

function fontconfig(): Font | undefined {
	try {
		const out = execFileSync("fc-match", ["-f", "%{family[0]}\t%{file}", "monospace"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const [family, file] = out.split("\t");
		return family && file && existsSync(file) ? { family, file } : undefined;
	} catch {
		return undefined;
	}
}

/** Pele's text measurer for a monospace font: a wide character takes two columns, as in the terminal. */
export const monoMeasurer = {
	width: (text: string, size: number): number => visibleWidth(text) * size * MONO_ADVANCE,
};

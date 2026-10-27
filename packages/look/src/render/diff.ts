// An edit's diff inside the frame, without pi's colored box behind it: the line numbers in a gutter,
// the sign and the text in the diff colors, and only the changed words on a tinted background.
import { GLYPH, isObject } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { diffWords } from "diff";

import { printable } from "./streaming.ts";

interface DiffLine {
	sign: "-" | "+" | " ";
	number: string;
	text: string;
}

const COLORS: Record<DiffLine["sign"], ThemeColor> = {
	"-": "toolDiffRemoved",
	"+": "toolDiffAdded",
	" ": "toolDiffContext",
};

/** Pi's diff text, one line per row, with the number gutter and the wrapped text hanging under itself. */
export function drawDiff(diff: string, theme: Theme, width: number): string[] {
	const lines = diff.split("\n").map(parse);
	const gutter = Math.max(...lines.map((line) => line?.number.length ?? 0), 1);
	const texts = changedWords(lines, theme);
	// The number, a space, the sign and a space; wrapped text hangs under its first character.
	const hang = " ".repeat(gutter + 3);
	return lines.flatMap((line, index) => {
		if (line === undefined) return [];
		if (line.number === "" && line.text === "...")
			return [`${hang}${theme.fg("dim", GLYPH.ellipsisAcross)}`];
		const lead = `${theme.fg("dim", line.number.padStart(gutter))} ${theme.fg(COLORS[line.sign], line.sign)} `;
		const text = texts[index] ?? theme.fg(COLORS[line.sign], line.text);
		return wrapTextWithAnsi(text, Math.max(1, width - hang.length)).map((part, at) =>
			at === 0 ? `${lead}${part}` : `${hang}${part}`,
		);
	});
}

/**
 * Pi's edit body while it holds the file's diff, drawn here; before that, pi's own drawing.
 * Pi keeps the diff on the component it returns, as `preview`.
 */
export function editBody(own: Component, header: string, theme: Theme): Component {
	return {
		render(width) {
			const preview = isObject(own) && "preview" in own ? own.preview : undefined;
			if (!isObject(preview)) return own.render(width);
			if (typeof preview.error === "string")
				return [header, "", ...wrapTextWithAnsi(theme.fg("error", preview.error), width)];
			if (typeof preview.diff !== "string") return own.render(width);
			return [header, "", ...drawDiff(preview.diff, theme, width)];
		},
		invalidate: () => own.invalidate(),
	};
}

function parse(line: string): DiffLine | undefined {
	if (line === "") return undefined;
	const match = /^([+\- ])( *\d*) (.*)$/.exec(line);
	if (match === null) return { sign: " ", number: "", text: printable(line) };
	const sign = match[1] as DiffLine["sign"];
	return { sign, number: (match[2] ?? "").trim(), text: printable(match[3] ?? "") };
}

/** One line taken out and one put in is a changed line: its changed words get the tint. */
function changedWords(
	lines: readonly (DiffLine | undefined)[],
	theme: Theme,
): (string | undefined)[] {
	const texts: (string | undefined)[] = [];
	for (let index = 0; index + 1 < lines.length; index++) {
		const out = lines[index];
		const into = lines[index + 1];
		if (out?.sign !== "-" || into?.sign !== "+") continue;
		if (lines[index - 1]?.sign === "-" || lines[index + 2]?.sign === "+") continue;
		let removed = "";
		let added = "";
		for (const part of diffWords(out.text, into.text)) {
			if (part.removed) removed += theme.bg("toolErrorBg", part.value);
			else if (part.added) added += theme.bg("toolSuccessBg", part.value);
			else {
				removed += part.value;
				added += part.value;
			}
		}
		texts[index] = theme.fg("toolDiffRemoved", removed);
		texts[index + 1] = theme.fg("toolDiffAdded", added);
	}
	return texts;
}

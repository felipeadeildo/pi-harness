// A diff, drawn by what each line does: added, removed, or the header that says which file and
// where. Nothing here decides what is a change in a language; it reads the marks a diff already
// carries, so it draws the same for a tool, a model or a patch from another machine.
import { type ReactNode, createElement as h } from "react";

import { plain } from "./plain.ts";

export type DiffLineKind = "added" | "removed" | "hunk" | "file" | "context";

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
}

/** The kind of a line of unified diff, which is what its first characters say. */
export function kindOf(line: string): DiffLineKind {
	if (line.startsWith("+++") || line.startsWith("---")) return "file";
	if (line.startsWith("@@")) return "hunk";
	if (line.startsWith("+")) return "added";
	if (line.startsWith("-")) return "removed";
	return "context";
}

export function diffLines(text: string): DiffLine[] {
	return plain(text)
		.split("\n")
		.map((line) => ({ kind: kindOf(line), text: line }));
}

/** Draws a unified diff, one line per row, keeping the mark that says what the line does. */
export function Diff({ text }: { text: string }): ReactNode {
	const lines = diffLines(text);
	return h(
		"pre",
		{ className: "remote-diff" },
		...lines.map((line, index) =>
			h(
				"div",
				{ key: `l${index}`, className: `remote-diff-${line.kind}` },
				h(
					"span",
					{ className: "remote-diff-mark" },
					line.kind === "context" ? " " : line.text.charAt(0),
				),
				h("span", undefined, line.kind === "context" ? line.text : line.text.slice(1)),
			),
		),
	);
}

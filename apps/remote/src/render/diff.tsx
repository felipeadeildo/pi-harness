"use dom";

import { createElement as h, type ReactNode } from "react";

import { diffLines } from "./diff-lines.ts";

interface DiffProps {
	text: string;
	dom?: import("expo/dom").DOMProps;
}

/** Draws a unified diff, one line per row, keeping the mark that says what the line does. */
export default function Diff({ text }: DiffProps): ReactNode {
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

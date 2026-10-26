// An edit's unified patch, drawn by @pierre/diffs: highlighted, with word-level changes and line
// numbers. Loaded the first time a diff opens.
import type { FileDiffOptions } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { type CSSProperties, type ReactNode } from "react";

const OPTIONS: FileDiffOptions<undefined, undefined> = {
	theme: { dark: "pierre-dark", light: "pierre-light" },
	themeType: "system",
	diffStyle: "unified",
	disableFileHeader: true,
	overflow: "wrap",
	// The page's policy runs no WebAssembly, so shiki uses its JavaScript regex engine.
	preferredHighlighter: "shiki-js",
};

const LOOK = {
	"--diffs-font-family": '"Paper Mono", ui-monospace, monospace',
	"--diffs-font-size": "12.5px",
	"--diffs-line-height": "1.55",
} as CSSProperties;

export default function Diff({ patch }: { patch: string }): ReactNode {
	return (
		<div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
			<PatchDiff patch={patch} options={OPTIONS} style={LOOK} />
		</div>
	);
}

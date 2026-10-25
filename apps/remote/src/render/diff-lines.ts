// A diff, drawn by what each line does: added, removed, or the header that says which file and
// where. Nothing here decides what is a change in a language; it reads the marks a diff already
// carries, so it draws the same for a tool, a model or a patch from another machine.
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

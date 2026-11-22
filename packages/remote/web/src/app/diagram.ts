// What a ```mermaid block can show: all of it once the answer ends, and while it streams, the lines
// already written that parse, so the diagram grows with the answer.
import { longestDrawable } from "@adeildo/pi-diagrams/partial";
import { parse } from "pele";

export type Drawable = { text: string } | { error: string } | undefined;

export function drawable(code: string, streaming: boolean): Drawable {
	if (streaming) {
		const found = longestDrawable(code, false, parse);
		return found && { text: found.text };
	}
	try {
		parse(code);
		return { text: code };
	} catch (error) {
		return { error: describe(error) };
	}
}

/** Pele's syntax errors put the line first and what it expected last, with the source between. */
function describe(error: unknown): string {
	const lines = (error instanceof Error ? error.message : String(error)).split("\n");
	const first = lines[0] ?? "";
	const last = lines.at(-1) ?? "";
	return lines.length > 1 ? `${first} ${last}` : first;
}

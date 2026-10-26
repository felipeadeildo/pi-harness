// What a phone may run by typing `/`, so the screen and the wire agree.

import type { SessionCommand } from "@adeildo/pi-remote-protocol";

export interface Offered {
	name: string;
	description?: string;
	source: string;
}

/** Skills, templates and the harness's own commands. Extension commands would run at the terminal's privilege. */
export function commandsFor(offered: readonly Offered[]): SessionCommand[] {
	const commands: SessionCommand[] = offered
		.filter((one) => one.source === "skill" || one.source === "prompt")
		.map((one) => ({
			name: one.name,
			...(one.description === undefined ? {} : { description: one.description }),
			source: one.source === "skill" ? "skill" : "prompt",
		}));
	// `compact` is not in pi's list; the harness answers it.
	return [
		...commands,
		{ name: "compact", description: "Ask pi to compact this session", source: "pi" },
	];
}

export type Slash = "compact" | "expand" | "refused";

const COMPACT = /^\/compact(?:\s+([\s\S]*))?$/;

/** A name is accepted only if the session offers it, so an unknown one is never expanded into the model. */
export function slashOf(text: string, offered: readonly SessionCommand[]): Slash {
	if (!text.startsWith("/")) return "expand";
	const typed = text.slice(1).split(/\s/, 1)[0] ?? "";
	if (typed === "compact") return "compact";
	// Positive on both sides, so a new `source` must be decided here.
	const known = offered.some(
		(one) => one.name === typed && (one.source === "skill" || one.source === "prompt"),
	);
	return known ? "expand" : "refused";
}

export function compactInstructions(text: string): string | undefined {
	const instructions = COMPACT.exec(text)?.[1]?.trim();
	return instructions === undefined || instructions === "" ? undefined : instructions;
}

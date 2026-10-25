// What a phone may run by typing `/`. One function decides, and it reads the same list the session
// offers: a name the screen shows and a name the wire accepts cannot disagree.

import type { SessionCommand } from "@adeildo/pi-remote-protocol";

/** One command as pi describes it, before this file decides what a client may do with it. */
export interface Offered {
	name: string;
	description?: string;
	source: string;
}

/**
 * The commands a client may run: skills and templates, plus what this harness answers itself.
 *
 * An extension command is left out, and that is the point: with `expandPromptTemplates` such a name
 * would run at the terminal's privilege from a phone. Filtering here means the list the screen shows
 * is already the list the wire accepts.
 */
export function commandsFor(offered: readonly Offered[]): SessionCommand[] {
	const commands: SessionCommand[] = offered
		.filter((one) => one.source === "skill" || one.source === "prompt")
		.map((one) => ({
			name: one.name,
			...(one.description === undefined ? {} : { description: one.description }),
			source: one.source === "skill" ? "skill" : "prompt",
		}));
	// `compact` is not in pi's list: this harness answers it, with the same effect `session.compact`
	// has, so the phone can find it and there is still one path to one effect.
	return [
		...commands,
		{ name: "compact", description: "Ask pi to compact this session", source: "pi" },
	];
}

/** What the harness does with a text a client typed. */
export type Slash = "compact" | "expand" | "refused";

const COMPACT = /^\/compact(?:\s+([\s\S]*))?$/;

/**
 * Reads one text. A text that does not start with `/` is a prompt, and comes back as `expand`: the two
 * are told apart by the caller, because "send it as it is" is the same act either way.
 *
 * A name is accepted only if the session offers it. The list is the one the screen shows, so a command
 * that appeared after the list was sent — or one this harness never offers — is refused instead of
 * being expanded into the model.
 */
export function slashOf(text: string, offered: readonly SessionCommand[]): Slash {
	if (!text.startsWith("/")) return "expand";
	const typed = text.slice(1).split(/\s/, 1)[0] ?? "";
	if (typed === "compact") return "compact";
	// Positive on both sides, like `commandsFor`: a `source` added later must be a decision here, not a
	// default that slips through.
	const known = offered.some(
		(one) => one.name === typed && (one.source === "skill" || one.source === "prompt"),
	);
	return known ? "expand" : "refused";
}

/** The instruction beside `/compact`, which pi takes as the summary request. */
export function compactInstructions(text: string): string | undefined {
	const instructions = COMPACT.exec(text)?.[1]?.trim();
	return instructions === undefined || instructions === "" ? undefined : instructions;
}

// Typing `/` in the composer offers what the session says it can run — nothing else. The list is the
// host's, so a command the bridge would refuse never appears; a text that only looks like one stays text.

import type { SessionCommand } from "@adeildo/pi-remote-protocol";

/** What the field shows while the person types a slash command. */
export interface Suggestion {
	/** What goes into the draft when it is chosen, always with the leading slash. */
	name: string;
	description?: string;
	/** Which group it belongs to, so the list can say "skills" and "templates" instead of one heap. */
	source: SessionCommand["source"];
}

/** Whether the draft is a slash command being typed: it starts with `/` and holds one word. */
export function typingCommand(draft: string): boolean {
	return /^\/[^\s]*$/.test(draft);
}

/**
 * The commands that match what was typed, in the order the host gave them. A draft that is not a slash
 * command matches nothing: the field is a prompt, and a prompt with a `/` in the middle is not one.
 */
export function suggested(draft: string, commands: readonly SessionCommand[]): Suggestion[] {
	if (!typingCommand(draft)) return [];
	const typed = draft.slice(1).toLowerCase();
	return commands
		.filter((command) => command.name.toLowerCase().startsWith(typed))
		.map((command) => ({
			name: `/${command.name}`,
			...(command.description === undefined ? {} : { description: command.description }),
			source: command.source,
		}));
}

/**
 * The draft after choosing a command: the command, a space, and nothing else. The instruction beside a
 * command is part of the prompt — `/compact keep the tests` is one message to the same effect.
 */
export function chosen(name: string): string {
	return `${name} `;
}

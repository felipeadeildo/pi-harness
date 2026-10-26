// `/` offers what the session says it can run, and nothing else.

import type { SessionCommand } from "@adeildo/pi-remote-protocol";

export interface Suggestion {
	/** With the leading slash. */
	name: string;
	description?: string;
	/** So the list can group skills and templates. */
	source: SessionCommand["source"];
}

export function typingCommand(draft: string): boolean {
	return /^\/[^\s]*$/.test(draft);
}

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

export function chosen(name: string): string {
	return `${name} `;
}

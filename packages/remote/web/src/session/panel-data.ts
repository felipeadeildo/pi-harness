// What the chrome lists, apart from the views, so a test can read it.
import type { SessionState } from "@adeildo/pi-remote-protocol";

import { plain } from "./plain.ts";

/** The title comes from another extension, so it goes through `plain`. */
export function terminalWait(prompt: SessionState["prompt"]): string | undefined {
	if (prompt === undefined) return undefined;
	const title = prompt.title === undefined ? "" : plain(prompt.title).trim();
	if (title !== "") return `Waiting in the terminal: ${title}`;
	return `Waiting in the terminal: ${prompt.kind === "editor" ? "an editor" : "a dialog"}`;
}

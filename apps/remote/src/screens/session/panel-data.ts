// What the chrome lists, apart from the views that draw it: a phone draws with views, and a test cannot.
import type { SessionState, SessionTasks } from "@adeildo/pi-remote-protocol";

import { plain } from "../../render/index.ts";

/** The tasks a session is on, never what is done or dropped. */
const OPEN: ReadonlySet<string> = new Set(["doing", "waiting", "queued"]);

/** The tasks a session is on, and the line each draws. */
export function openTasksOf(tasks: SessionTasks | undefined): { id: string; line: string }[] {
	return (tasks?.tasks ?? [])
		.filter((task) => OPEN.has(task.status))
		.map((task) => ({ id: task.id, line: `${task.status} · ${plain(task.text)}` }));
}

/**
 * The line for a dialog only the terminal can answer, or nothing when the terminal waits on none. The
 * title is text from another extension, so it goes through `plain`; a dialog with no title is named by
 * what it is, because "waiting in the terminal" alone leaves the person asking for what.
 */
export function terminalWait(prompt: SessionState["prompt"]): string | undefined {
	if (prompt === undefined) return undefined;
	const title = prompt.title === undefined ? "" : plain(prompt.title).trim();
	const what = title !== "" ? title : prompt.kind === "editor" ? "an editor" : "a dialog";
	return `Waiting in the terminal: ${what}`;
}

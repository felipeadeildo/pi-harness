// What the chrome lists, apart from the views that draw it: a phone draws with views, and a test cannot.
import type { SessionTasks } from "@adeildo/pi-remote-protocol";

import { plain } from "../../render/index.ts";

/** The tasks a session is on, never what is done or dropped. */
const OPEN: ReadonlySet<string> = new Set(["doing", "waiting", "queued"]);

/** The tasks a session is on, and the line each draws. */
export function openTasksOf(tasks: SessionTasks | undefined): { id: string; line: string }[] {
	return (tasks?.tasks ?? [])
		.filter((task) => OPEN.has(task.status))
		.map((task) => ({ id: task.id, line: `${task.status} · ${plain(task.text)}` }));
}

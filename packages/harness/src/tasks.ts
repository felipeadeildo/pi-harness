import { tasks } from "@adeildo/pi-board";
import { createApp, names } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessTasks(pi: ExtensionAPI): void {
	// The order matters: the names feature only draws when the tasks already has no handle, so a
	// session that predates the list keeps the one it was given. Mounted the other way round, every
	// older session is renamed at its next start.
	createApp(pi, { name: "pi-harness" }).use(tasks).use(names()).build();
}

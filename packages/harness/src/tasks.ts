import { createApp, names } from "@adeildo/pi-kit";
import { tasks } from "@adeildo/pi-tasks";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessTasks(pi: ExtensionAPI): void {
	// The names feature comes after the tasks: it only draws when the tasks have no handle yet, so
	// mounting it first would rename a session that started before the list existed.
	createApp(pi, { name: "pi-harness" }).use(tasks).use(names()).build();
}

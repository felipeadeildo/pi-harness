import { goal } from "@adeildo/pi-goal";
import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessGoal(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(goal).build();
}

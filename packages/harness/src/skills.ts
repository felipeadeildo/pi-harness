import { createApp } from "@adeildo/pi-kit";
import { skills } from "@adeildo/pi-skills";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessSkills(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(skills).build();
}

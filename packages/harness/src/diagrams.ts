import { diagrams } from "@adeildo/pi-diagrams";
import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessDiagrams(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(diagrams).build();
}

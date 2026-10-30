import { createApp } from "@adeildo/pi-kit";
import { web } from "@adeildo/pi-web";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessWeb(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(web).build();
}

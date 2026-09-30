import { createApp } from "@adeildo/pi-kit";
import { look } from "@adeildo/pi-look";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessLook(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(look).build();
}

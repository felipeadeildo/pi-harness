import { createApp } from "@adeildo/pi-kit";
import { remote } from "@adeildo/pi-remote";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessRemote(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(remote).build();
}

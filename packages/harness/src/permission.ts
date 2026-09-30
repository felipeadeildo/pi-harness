import { permission } from "@adeildo/pi-ask-permission";
import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessPermission(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(permission).build();
}

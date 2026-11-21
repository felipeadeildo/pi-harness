import { createApp, names, piDocs } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessNames(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(names()).use(piDocs()).build();
}

import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { subscription } from "./subscription/feature.ts";

export { claudeCodeVersion, subscription } from "./subscription/feature.ts";

export default function piProviders(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(subscription).build();
}

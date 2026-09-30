import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { accounts } from "./accounts/feature.ts";
import { subscription } from "./subscription/feature.ts";

export { accounts, onLimit, WHEN_LIMITED, type WhenLimited } from "./accounts/feature.ts";
export { accountsPath, AccountStore } from "./accounts/store.ts";
export { claudeCodeVersion, subscription } from "./subscription/feature.ts";

export default function piProviders(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-providers" }).use(subscription).use(accounts).build();
}

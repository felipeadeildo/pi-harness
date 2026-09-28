import { createApp, defineFeature } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { listenForTools } from "#pi/api.ts";
import { registerBashTimer } from "#pi/bash-timer.ts";
import { registerCommands } from "#pi/commands.ts";
import { registerEvents } from "#pi/events.ts";
import { registerTypesafeProvider } from "#pi/provider.ts";
import { createSession } from "#pi/session.ts";
import { registerJudgeEntry } from "#ui/judge-entry.ts";

export const permission = defineFeature({
	id: "permission",
	description: "Ask before a tool call runs, with a judge model for the routine ones",
	setup(scope) {
		registerBashTimer(scope);
		registerTypesafeProvider(scope);
		registerJudgeEntry(scope);

		const session = createSession();
		registerEvents(scope, session);
		listenForTools(scope, session.customTools);
		registerCommands(scope, session);
	},
});

export default function piAskPermission(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-ask-permission" }).use(permission).build();
}

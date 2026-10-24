import { questions } from "@adeildo/pi-ask-questions";
import { createApp, defineFeature, MODE, MODE_SET, protectedList } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PERMISSION_SETTINGS, readConfig, SECTIONS } from "#core/config/settings.ts";
import { NAME } from "#identity";
import { listenForTools } from "#pi/api.ts";
import { registerBashTimer } from "#pi/bash-timer.ts";
import { registerShortcuts } from "#pi/commands.ts";
import { registerEvents } from "#pi/events.ts";
import { setSessionMode } from "#pi/mode.ts";
import { registerScreen } from "#pi/screen.ts";
import { createSession } from "#pi/session.ts";
import { registerJudgeEntry } from "#ui/judge-entry.ts";
import { registerNoteMessage } from "#ui/note-message.ts";
import { registerRulingLine } from "#ui/ruling-line.ts";

export const permission = defineFeature({
	id: "permission",
	description: "Ask before a tool call runs, with a judge model for the routine ones",
	sections: SECTIONS,
	settings: PERMISSION_SETTINGS,
	setup(scope) {
		registerBashTimer(scope);
		registerJudgeEntry(scope);
		registerNoteMessage(scope);

		const session = createSession();
		MODE.provide(scope, () => session.mode);
		// A client asks here, and the change goes through the same path as Alt+M: recorded, shown and
		// announced, so a reader of `MODE` learns of it the way it learns of a change at the keyboard.
		MODE_SET.provide(scope, () => ({
			set: (mode, by) => {
				const ctx = session.ctx;
				if (ctx === undefined) throw new Error("this session has not started yet");
				setSessionMode(scope, session, mode, ctx, by === undefined);
				if (by !== undefined) ctx.ui.notify(`${NAME}: ${mode}, set from ${by.name}`, "info");
			},
		}));
		session.protected = () => protectedList(scope.events);
		registerRulingLine(scope, session);
		registerEvents(scope, session);
		listenForTools(scope, session.customTools);
		registerShortcuts(scope, session);
		registerScreen(scope, session);

		// A change on the screen, or in another pi, applies to the next call.
		for (const entry of PERMISSION_SETTINGS) {
			entry.listen(scope, () => {
				session.config = readConfig(scope);
				session.judgeCache.clear();
			});
		}
	},
});

export default function piAskPermission(pi: ExtensionAPI): void {
	// The dialog is the questions feature's. It comes with the package, and the kit keeps it from
	// running twice when the questions package or the harness is installed as well.
	createApp(pi, { name: "pi-ask-permission" }).use(questions).use(permission).build();
}

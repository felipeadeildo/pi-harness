// What the commands need from pi's extension API, built where both the feature scope and the session
// context are at hand. The bridge holds the context, which aborts and compacts; renaming and the two
// settings go through the API, and each one answers or refuses with a reason a client can show.
import {
	logFrom,
	MODE_SET,
	PERMISSION_MODES,
	type PermissionMode,
	type FeatureScope,
} from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SessionApi } from "./bridge/bridge.ts";
import { Refused } from "./bridge/commands.ts";

/** pi's own thinking levels, as the `/thinking` command offers them, `off` included. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** The first line of what arrived, since a terminal note is one line. */
function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return text.includes("\n") ? `${line} …` : line;
}

export function isThinkingLevel(level: string): level is ThinkingLevel {
	return THINKING_LEVELS.some((one) => one === level);
}

function isPermissionMode(mode: string): mode is PermissionMode {
	return PERMISSION_MODES.some((one) => one === mode);
}

export function commandApi(scope: FeatureScope, ctx: ExtensionContext): SessionApi {
	return {
		rename: (name) => {
			scope.setSessionName(name);
		},
		setModel: async (provider, id) => {
			const model = ctx.modelRegistry.find(provider, id);
			if (model === undefined) throw new Refused(`no model ${provider}/${id} on this machine`);
			// pi answers false when it kept the model it had: a client that hears nothing would think it
			// switched, so the answer says it did not.
			if (!(await scope.setModel(model))) throw new Refused("the model stayed as it was");
		},
		setThinking: (level) => {
			if (!isThinkingLevel(level))
				throw new Refused(`${level} is not a thinking level: ${THINKING_LEVELS.join(", ")}`);
			scope.setThinkingLevel(level);
		},
		busy: () => !ctx.isIdle(),
		send: (text, deliverAs) => {
			scope.sendUserMessage(text, deliverAs === undefined ? {} : { deliverAs });
		},
		arrived: (text, by) => {
			// The fact is what a reader of the log needs; the line is what the person at the terminal
			// needs, since the message itself already went in as an ordinary one.
			logFrom(ctx, scope.events, "prompt.received", { by });
			ctx.ui.notify(`From ${by.name}: ${firstLine(text)}`, "info");
		},
		setMode: (mode, by) => {
			// `full` runs every call without asking, and a rule or a stolen phone must not reach it: it
			// is set at the terminal, where the person is looking at the session it applies to.
			if (mode === "full") throw new Refused("full is only set at the terminal");
			if (!isPermissionMode(mode)) throw new Refused(`${mode} is not a permission mode`);
			const control = MODE_SET.current(scope);
			if (control === undefined)
				throw new Refused("this session has no permission feature to change the mode");
			control.set(mode, by);
		},
	};
}

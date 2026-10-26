import {
	logFrom,
	MODE_SET,
	PERMISSION_MODES,
	type PermissionMode,
	type FeatureScope,
} from "@adeildo/pi-kit";
import { THINKING_LEVELS } from "@adeildo/pi-remote-protocol";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SessionApi } from "./bridge/bridge.ts";
import { Refused } from "./bridge/commands.ts";
import { commandsFor, compactInstructions, slashOf } from "./bridge/slash.ts";

export { THINKING_LEVELS };

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

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
			// Pi answers false when it kept the model, so the client hears it did not switch.
			if (!(await scope.setModel(model))) throw new Refused("the model stayed as it was");
		},
		setThinking: (level) => {
			if (!isThinkingLevel(level))
				throw new Refused(`${level} is not a thinking level: ${THINKING_LEVELS.join(", ")}`);
			scope.setThinkingLevel(level);
		},
		busy: () => !ctx.isIdle(),
		send: (text, deliverAs) => {
			// Decided against the list the phone shows, so an unoffered name never reaches the model.
			const slash = slashOf(text, commandsFor(scope.getCommands()));
			if (slash === "refused") {
				throw new Refused(`${firstLine(text)} is not a command this session offers`);
			}
			if (slash === "compact") {
				// The same effect as `session.compact`.
				const instructions = compactInstructions(text);
				void ctx.compact(
					instructions === undefined ? undefined : { customInstructions: instructions },
				);
				return;
			}
			scope.sendUserMessage(text, {
				...(deliverAs === undefined ? {} : { deliverAs }),
				// Only a slash text expands, so `/skill:x` works from the phone and a prompt goes out as typed.
				...(text.startsWith("/") ? { expandPromptTemplates: true } : {}),
			});
		},
		arrived: (text, by) => {
			// The log needs the state change; the terminal needs the line.
			logFrom(ctx, scope.events, "prompt.received", { by });
			ctx.ui.notify(`From ${by.name}: ${firstLine(text)}`, "info");
		},
		setMode: (mode, by) => {
			// `full` is set only at the terminal, so a stolen phone cannot reach it.
			if (mode === "full") throw new Refused("full is only set at the terminal");
			if (!isPermissionMode(mode)) throw new Refused(`${mode} is not a permission mode`);
			const control = MODE_SET.current(scope);
			if (control === undefined)
				throw new Refused("this session has no permission feature to change the mode");
			control.set(mode, by);
		},
	};
}

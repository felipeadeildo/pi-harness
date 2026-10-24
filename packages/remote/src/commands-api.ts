// What the commands need from pi's extension API, built where both the feature scope and the session
// context are at hand. The bridge holds the context, which aborts and compacts; renaming and the two
// settings go through the API, and each one answers or refuses with a reason a client can show.
import type { FeatureScope } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SessionApi } from "./bridge/bridge.ts";

/** pi's own thinking levels, as the `/thinking` command offers them. */
export const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isThinkingLevel(level: string): level is ThinkingLevel {
	return THINKING_LEVELS.some((one) => one === level);
}

export function commandApi(scope: FeatureScope, ctx: ExtensionContext): SessionApi {
	return {
		rename: (name) => {
			scope.setSessionName(name);
		},
		setModel: async (provider, id) => {
			const model = ctx.modelRegistry.find(provider, id);
			if (model === undefined) throw new Error(`no model ${provider}/${id} on this machine`);
			// pi answers false when it kept the model it had: a client that hears nothing would think it
			// switched, so the answer says it did not.
			if (!(await scope.setModel(model))) throw new Error("the model stayed as it was");
		},
		setThinking: (level) => {
			if (!isThinkingLevel(level))
				throw new Error(`${level} is not a thinking level: ${THINKING_LEVELS.join(", ")}`);
			scope.setThinkingLevel(level);
		},
	};
}

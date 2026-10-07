import { type Control, type Decoder, fail, pass, problem, setting, string } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { AUTO, modelRef, SESSION } from "./models.ts";

export const MODEL_SECTION = "Model";

export const model = setting({
	id: "goal.model",
	default: AUTO,
	decoder: string,
	ui: {
		section: MODEL_SECTION,
		label: "Model",
		description:
			"The model that keeps the goal up to date. When it fails, the session's model answers.",
		control: modelControl,
	},
});

const seconds: Decoder<number> = {
	control: { type: "number", min: 0, max: 3600, step: 5, unit: "s" },
	decode(input, path) {
		if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 3600)
			return fail(problem(path, "expected seconds from 0 to 3600"));
		return pass(input);
	},
};

export const interval = setting({
	id: "goal.interval",
	default: 0,
	decoder: seconds,
	ui: {
		section: MODEL_SECTION,
		label: "While the agent works",
		description:
			"Seconds between updates during a long turn, which can only put follow-ups off: steps close when the agent stops. 0, the default, updates it only on your messages and when the agent stops.",
		control: { type: "number", min: 0, max: 3600, step: 15, unit: "s" },
	},
});

export const GOAL_SETTINGS = [model, interval];

function modelControl(ctx: ExtensionContext): Control {
	return {
		type: "choice",
		options: [
			{ value: AUTO, description: "the cheapest model of the session's provider" },
			{ value: SESSION, description: "the model you are talking to" },
			...ctx.modelRegistry.getAvailable().map((entry) => ({ value: modelRef(entry) })),
		],
	};
}

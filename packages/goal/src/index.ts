import {
	answerGoal,
	createApp,
	defineFeature,
	GOAL_CHANGED,
	GOAL_STATE,
	nowOf,
} from "@adeildo/pi-kit";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { Keeper } from "./keeper.ts";
import { modelsFor } from "./models.ts";
import { registerScreen, sessionSection } from "./screen.ts";
import { GOAL_SETTINGS, interval, MODEL_SECTION, model } from "./settings.ts";
import { operatorText } from "./transcript.ts";
import { Updates } from "./updates.ts";

/** The look draws this status as its goal segment. */
export const GOAL_STATUS = "pi-goal";

export const goal = defineFeature({
	id: "goal",
	tab: "Goal",
	description: "Keeps the session's goal, the current step, what was done and what was left",
	sections: (ctx) => [sessionSection(ctx), MODEL_SECTION],
	settings: GOAL_SETTINGS,
	setup(scope) {
		let session: ExtensionContext | undefined;
		const keeper = new Keeper(
			(customType, data) => scope.appendEntry(customType, data),
			(trigger) => {
				if (trigger !== "tidy") updates.changed();
				show();
			},
		);
		const updates = new Updates(keeper, {
			models: (ctx) => modelsFor(model.get(scope), ctx.modelRegistry, ctx.model),
			interval: () => interval.get(scope),
		});

		function show(): void {
			const state = keeper.state();
			const current = nowOf(state);
			const running = updates.working ? current?.activeForm : undefined;
			const words = running ?? current?.text ?? state.goal;
			session?.ui.setStatus(GOAL_STATUS, words === undefined ? undefined : `\u25b8 ${words}`);
			scope.events.emit(GOAL_CHANGED, state);
		}

		function restore(ctx: ExtensionContext): void {
			keeper.restore(ctx.sessionManager.getBranch());
			updates.reset();
			show();
		}

		scope.onSessionStart((ctx) => {
			session = ctx;
			updates.start();
			restore(ctx);
		});
		scope.on("session_tree", (_event, ctx) => restore(ctx));
		scope.onShutdown(() => {
			updates.stop();
			session = undefined;
		});

		scope.events.on(GOAL_STATE, (data: unknown) =>
			answerGoal(data, keeper.state(), {
				settling: updates.settling,
				working: updates.working,
			}),
		);

		// A queued steer counts once the agent reads it, not when you type it.
		scope.on("message_end", (event, ctx) => {
			if (!ctx.hasUI) return;
			const text = operatorText(event.message);
			if (text !== undefined) updates.message(ctx, text);
		});

		scope.on("agent_start", (_event, ctx) => {
			if (!ctx.hasUI) return;
			updates.runStarted();
			show();
		});

		scope.on("turn_end", (_event, ctx) => {
			if (ctx.hasUI) updates.turnEnded(ctx);
		});

		scope.on("agent_settled", (_event, ctx) => {
			if (!ctx.hasUI) return;
			updates.runEnded(ctx);
			show();
		});

		registerScreen(scope, keeper);
	},
});

export default function piGoal(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-goal" }).use(goal).build();
}

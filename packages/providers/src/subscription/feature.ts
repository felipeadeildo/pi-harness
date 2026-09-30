import { defineFeature, isObject, matching, setting } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { userAgent } from "./billing.ts";
import { billToPlan } from "./payload.ts";

export const claudeCodeVersion = setting({
	id: "subscription.claudeCodeVersion",
	default: "2.1.280",
	decoder: matching(/^\d+\.\d+\.\d+$/, "a Claude Code version like 2.1.280"),
	ui: {
		section: "Anthropic subscription",
		label: "Claude Code version",
		description:
			"The Claude Code version pi reports to Anthropic. Anthropic refuses newer models to versions it considers too old.",
	},
});

export const subscription = defineFeature({
	id: "subscription",
	description: "Bill Anthropic OAuth requests to the Claude plan instead of extra usage",
	tab: "Providers",
	settings: [claudeCodeVersion],
	setup(scope) {
		scope.on("before_provider_headers", (event, ctx) => {
			if (usesSubscription(ctx))
				event.headers["user-agent"] = userAgent(claudeCodeVersion.get(scope));
		});

		scope.on("before_provider_request", (event, ctx) => {
			if (!usesSubscription(ctx) || !isObject(event.payload)) return undefined;
			return billToPlan(event.payload, claudeCodeVersion.get(scope));
		});
	},
});

function usesSubscription(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	if (model === undefined || model.api !== "anthropic-messages") return false;
	return ctx.modelRegistry.isUsingOAuth(model);
}

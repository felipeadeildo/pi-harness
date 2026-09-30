// The provider's own login asks for a code, a URL or a choice. These dialogs answer for it, so no
// OAuth and no key prompt live in this package.
import type { AuthEvent, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const LOGIN_KEY = "pi-providers:login";

export function interactionFor(
	ctx: ExtensionContext,
	label: string,
	signal: AbortSignal,
): ProviderAuthInteraction {
	return {
		signal,
		async prompt(prompt) {
			if (prompt.type === "select") {
				const options = prompt.options.map((option) => option.label);
				const picked = await ctx.ui.select(prompt.message, options, { signal: prompt.signal });
				if (picked === undefined) throw new Error(`${label}: login cancelled`);
				return prompt.options.find((option) => option.label === picked)?.id ?? picked;
			}
			const value = await ctx.ui.input(prompt.message, prompt.placeholder, {
				signal: prompt.signal,
			});
			if (value === undefined) throw new Error(`${label}: login cancelled`);
			return value;
		},
		notify(event) {
			show(ctx, event);
		},
	};
}

function show(ctx: ExtensionContext, event: AuthEvent): void {
	switch (event.type) {
		case "info":
			ctx.ui.notify(withLinks(event.message, event.links), "info");
			break;
		case "auth_url":
			ctx.ui.notify(
				withLinks(event.instructions ?? "Open this URL to sign in", [{ url: event.url }]),
				"info",
			);
			break;
		case "device_code":
			ctx.ui.notify(`Enter ${event.userCode} at ${event.verificationUri}`, "info");
			break;
		case "progress":
			ctx.ui.setStatus(LOGIN_KEY, event.message);
			break;
	}
}

function withLinks(
	message: string,
	links: readonly { url: string; label?: string }[] | undefined,
): string {
	if (links === undefined || links.length === 0) return message;
	return `${message} ${links.map((link) => link.label ?? link.url).join(" ")}`;
}

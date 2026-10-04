// The provider's own login asks for a code, a URL or a choice. Our framed screen answers it; a host
// that cannot draw one falls back to pi's own dialogs.
import type { AuthEvent, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type LoginSession, loginScreen } from "../ui/login.ts";
import { pick } from "../ui/picker.ts";
import { LOGIN_KEY } from "./names.ts";

export async function loginFor(
	ctx: ExtensionContext,
	label: string,
	signal: AbortSignal,
): Promise<LoginSession> {
	const screen = await loginScreen(ctx, label, signal);
	return screen ?? { interaction: dialogs(ctx, label, signal), close: () => {} };
}

/** Pi's own dialogs, for a host without our screen. */
function dialogs(
	ctx: ExtensionContext,
	label: string,
	signal: AbortSignal,
): ProviderAuthInteraction {
	return {
		signal,
		async prompt(prompt) {
			if (prompt.type === "select") {
				const options = prompt.options.map((option) => option.label);
				const picked = await pick(ctx, prompt.message, options, { signal: prompt.signal });
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

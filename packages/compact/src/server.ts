// On Anthropic models, `clear_tool_uses` clears old tool output server-side and keeps the thinking,
// unlike a context edit (platform.claude.com/docs/en/build-with-claude/context-editing). The calls
// stay, since agents took their own reports for invented when the parameters went too.
import { isObject, mergeBetas } from "@adeildo/pi-kit";

import { clearAtLeast, KEPT_TOOLS } from "./prune.ts";

export const KEEP_TOOL_USES = 10;
const BETA = "context-management-2025-06-27";

/** Anthropic's own API only: other endpoints that speak it may refuse the beta. */
export function clearsOnServer(model: { provider: string; api: string } | undefined): boolean {
	return model?.provider === "anthropic" && model.api === "anthropic-messages";
}

/** Undefined leaves the payload as it is, like one another extension already manages. */
export function withServerClearing(payload: unknown, above: number): unknown {
	if (!isObject(payload) || payload.context_management !== undefined) return undefined;
	return {
		...payload,
		betas: mergeBetas(payload.betas, [BETA]).betas,
		context_management: {
			edits: [
				{
					type: "clear_tool_uses_20250919",
					trigger: { type: "input_tokens", value: above },
					keep: { type: "tool_uses", value: KEEP_TOOL_USES },
					clear_at_least: { type: "input_tokens", value: clearAtLeast(above) },
					exclude_tools: KEPT_TOOLS,
				},
			],
		},
	};
}

/** Pi does not pass on what the server cleared, so a drop of half the clearing minimum counts. */
export function serverCleared(previous: number, prompt: number, above: number): boolean {
	return previous - prompt >= clearAtLeast(above) / 2;
}

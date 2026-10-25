// The judge's intent: what the operator asked for, in their words and under the name they gave the
// session. Nothing the agent wrote reaches it, and there is nothing to wait for: the words are
// already in the branch when the judge reads it.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isRecord } from "#util/primitives.ts";

/** How many of the operator's messages the judge reads: a short "yes" needs the one before it. */
const RECENT_MESSAGES = 3;

export function intentFor(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
	const parts: string[] = [];
	const name = ctx.sessionManager.getSessionName()?.trim();
	if (name !== undefined && name !== "") parts.push(`Session: ${name}`);
	const recent = recentIntents(ctx);
	if (recent.length === 1) parts.push(`Last message: ${recent[0]}`);
	else if (recent.length > 1) {
		const lines = recent.map((text, index) => `  ${index + 1}. ${text}`);
		parts.push(`The operator's last messages, newest first:\n${lines.join("\n")}`);
	}
	return parts.length === 0 ? undefined : parts.join("\n");
}

/** The operator's last messages, newest first. Image-only ones take no slot, agent turns no place. */
export function recentIntents(
	ctx: Pick<ExtensionContext, "sessionManager">,
	limit = RECENT_MESSAGES,
): string[] {
	const branch: readonly unknown[] = ctx.sessionManager.getBranch();
	const texts: string[] = [];
	for (let index = branch.length - 1; index >= 0 && texts.length < limit; index--) {
		const text = userText(branch[index]);
		if (text !== undefined) texts.push(text);
	}
	return texts;
}

export function currentIntent(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
	return recentIntents(ctx, 1)[0];
}

function userText(entry: unknown): string | undefined {
	if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return undefined;
	if (entry.message.role !== "user") return undefined;

	return contentText(entry.message.content).trim() || undefined;
}

/** A message holds a string, or parts where only the text ones say anything. */
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const texts: string[] = [];
	for (const part of content) {
		if (isRecord(part) && part.type === "text" && typeof part.text === "string")
			texts.push(part.text);
	}
	return texts.join("\n");
}

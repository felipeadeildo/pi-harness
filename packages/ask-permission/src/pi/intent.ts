// What the user is after, for the judge. Today the last thing they typed; a service that knows the
// current intent better takes this place later, and the judge does not change.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isRecord } from "#util/primitives.ts";

export function currentIntent(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
	const branch: readonly unknown[] = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const text = userText(branch[index]);
		if (text !== undefined) return text;
	}
	return undefined;
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

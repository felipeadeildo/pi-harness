// Pi's summary on the side model, with your last words on top verbatim. eval/summary.ts
// found Haiku as good as Opus here for 1/40 of the price.
import type { ChatModel } from "@adeildo/pi-kit";
import {
	compact,
	type CompactionResult,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";

import type { AgentMessage } from "./prune.ts";

type CompactionPreparation = SessionBeforeCompactEvent["preparation"];
type Registry = Pick<ExtensionContext["modelRegistry"], "streamSimple">;

const MAX_ASKS = 8;
const MAX_ASK_CHARS = 400;

export interface SummaryRequest {
	preparation: CompactionPreparation;
	instructions?: string;
}

/** Undefined when no model answers. */
export async function summarize(
	request: SummaryRequest,
	models: readonly ChatModel[],
	registry: Registry,
	signal: AbortSignal,
): Promise<CompactionResult | undefined> {
	const stream: Parameters<typeof compact>[7] = (model, context, options) =>
		registry.streamSimple(model, context, options);
	for (const model of models) {
		// oxlint-disable-next-line no-await-in-loop -- the next model is only for when this one fails
		const written = await compact(
			request.preparation,
			model,
			undefined,
			undefined,
			request.instructions,
			signal,
			undefined,
			stream,
		).catch(() => undefined);
		if (signal.aborted) return undefined;
		if (written === undefined) continue;
		const asked = operatorAsks(request.preparation);
		return asked === "" ? written : { ...written, summary: `${asked}\n\n${written.summary}` };
	}
	return undefined;
}

/** The operator's last words in the part that pi compacts, as a heading and a list; empty without any. */
export function operatorAsks(preparation: CompactionPreparation): string {
	const asked = yourWords([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]);
	if (asked.length === 0) return "";
	return `## What the operator asked, newest last\n${asked.map((ask) => `- "${ask}"`).join("\n")}`;
}

function yourWords(messages: readonly AgentMessage[]): string[] {
	const words = messages.flatMap((message) => {
		if (message.role !== "user") return [];
		const text = (
			typeof message.content === "string"
				? message.content
				: message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
		)
			.replace(/<skill name="[^"]*"[^>]*>[\s\S]*?<\/skill>/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (text === "") return [];
		return [text.length <= MAX_ASK_CHARS ? text : `${text.slice(0, MAX_ASK_CHARS - 3)}...`];
	});
	return words.slice(-MAX_ASKS);
}

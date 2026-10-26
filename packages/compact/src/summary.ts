// Pi's summary on the side model, with the board and your last words on top verbatim. eval/summary.ts
// found Haiku as good as Opus here for 1/40 of the price.
import { type Board, type ChatModel, describeBoard } from "@adeildo/pi-kit";
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
	board: Board;
	preparation: CompactionPreparation;
	instructions?: string;
}

/** pi's compaction from the first model that answers, or undefined when none does. */
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
		const ours = standing(request);
		return ours === "" ? written : { ...written, summary: `${ours}\n\n${written.summary}` };
	}
	return undefined;
}

/** The board and your last words, as they are. */
export function standing({ board, preparation }: SummaryRequest): string {
	const parts: string[] = [];
	const stands = describeBoard(board, { done: 20, decisions: 20 });
	if (stands !== "") parts.push(`## Where the session stands\n${stands}`);
	const asked = yourWords([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]);
	if (asked.length > 0)
		parts.push(
			`## What the operator asked, newest last\n${asked.map((ask) => `- "${ask}"`).join("\n")}`,
		);
	return parts.join("\n\n");
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

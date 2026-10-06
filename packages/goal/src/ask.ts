// The model answers with operations, never a new timeline, so it cannot rewrite history.
import type { GoalOp, GoalUsage, SessionGoal } from "@adeildo/pi-kit";
import { type Api, type Model, type Tool, Type } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { modelRef } from "./models.ts";
import { opsOf, OPS } from "./ops.ts";
import {
	TIDY_PROMPT,
	tidyMessage,
	TOOL,
	UPDATE_PROMPT,
	type UpdateRequest,
	updateMessage,
} from "./prompts.ts";

const UPDATE_TOOL: Tool = {
	name: TOOL,
	description: "Apply operations to the session's timeline.",
	parameters: Type.Object({
		ops: Type.Array(
			Type.Object({
				op: Type.Union(OPS.map((name) => Type.Literal(name))),
				text: Type.Optional(Type.String()),
				active: Type.Optional(Type.String()),
				id: Type.Optional(Type.String()),
				note: Type.Optional(Type.String()),
			}),
		),
	}),
	constrainedSampling: { type: "json_schema", strict: "prefer" },
};

/** It closes, merges and retitles; it never opens a step. */
const TIDY_OPS = new Set<GoalOp["op"]>(["goal", "done", "drop", "rename"]);

export interface Proposal {
	ops: GoalOp[];
	model: string;
	usage: GoalUsage;
}

type Registry = ExtensionContext["modelRegistry"];

export function propose(
	registry: Registry,
	models: readonly Model<Api>[],
	request: UpdateRequest,
	signal: AbortSignal,
): Promise<Proposal | undefined> {
	return askForOps(registry, models, UPDATE_PROMPT, updateMessage(request), signal);
}

export async function tidy(
	registry: Registry,
	models: readonly Model<Api>[],
	request: { state: SessionGoal; session: string },
	signal: AbortSignal,
): Promise<Proposal | undefined> {
	const message = tidyMessage(request.state, request.session);
	const proposal = await askForOps(registry, models, TIDY_PROMPT, message, signal);
	if (proposal === undefined) return undefined;
	return { ...proposal, ops: proposal.ops.filter((op) => TIDY_OPS.has(op.op)) };
}

function askForOps(
	registry: Registry,
	models: readonly Model<Api>[],
	systemPrompt: string,
	content: string,
	signal: AbortSignal,
): Promise<Proposal | undefined> {
	return firstAnswer(models, signal, async (model) => {
		const reply = await registry
			.streamSimple(
				model,
				{
					systemPrompt,
					tools: [UPDATE_TOOL],
					messages: [{ role: "user", content, timestamp: Date.now() }],
				},
				{ signal },
			)
			.result();
		if (reply.stopReason === "error" || reply.stopReason === "aborted") return undefined;
		const call = reply.content.find((part) => part.type === "toolCall" && part.name === TOOL);
		if (call === undefined || call.type !== "toolCall") return undefined;
		return { ops: opsOf(call.arguments.ops), model: modelRef(model), usage: usageOf(reply.usage) };
	});
}

async function firstAnswer<T>(
	models: readonly Model<Api>[],
	signal: AbortSignal,
	ask: (model: Model<Api>) => Promise<T | undefined>,
): Promise<T | undefined> {
	for (const model of models) {
		// oxlint-disable-next-line no-await-in-loop -- the next model is only for when this one fails
		const answer = await ask(model).catch(() => undefined);
		if (answer !== undefined || signal.aborted) return answer;
	}
	return undefined;
}

function usageOf(usage: { input: number; output: number; cost: { total: number } }): GoalUsage {
	return { input: usage.input, output: usage.output, cost: usage.cost.total };
}

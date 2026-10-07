// The model answers with operations, never a new timeline, so it cannot rewrite history.
import type { GoalOp, GoalUsage, SessionGoal } from "@adeildo/pi-kit";
import type { Api, Model, Tool } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { modelRef } from "./models.ts";
import { checkOps, type Moment, opsOf, opsSchema, stepOf } from "./ops.ts";
import { PROMPTS, tidyMessage, TOOL, type UpdateRequest, updateMessage } from "./prompts.ts";
import { type Line, untimed } from "./transcript.ts";

function toolFor(moment: Moment): Tool {
	return {
		name: TOOL,
		description: "Apply operations to the session's timeline. An empty list changes nothing.",
		parameters: opsSchema(moment),
		constrainedSampling: { type: "json_schema", strict: "prefer" },
	};
}

export interface Proposal {
	ops: GoalOp[];
	/** What the checks refused, kept so a bad call can be studied later. */
	rejected: GoalOp[];
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
	const question = {
		moment: momentOf(request),
		content: updateMessage(request),
		read: untimed(request.news),
		state: request.state,
	};
	return askForOps(registry, models, question, signal);
}

function momentOf({ trigger, final }: UpdateRequest): Moment {
	return trigger === "work" && final !== true ? "working" : trigger;
}

export function tidy(
	registry: Registry,
	models: readonly Model<Api>[],
	request: { state: SessionGoal; session: readonly Line[] },
	signal: AbortSignal,
): Promise<Proposal | undefined> {
	const question = {
		moment: "tidy" as const,
		content: tidyMessage(request.state, request.session.map((line) => line.text).join("\n")),
		read: request.session,
		state: request.state,
	};
	return askForOps(registry, models, question, signal);
}

interface Question {
	moment: Moment;
	content: string;
	/** Where a proof has to be found. */
	read: readonly Line[];
	state: SessionGoal;
}

async function askForOps(
	registry: Registry,
	models: readonly Model<Api>[],
	{ moment, content, read, state }: Question,
	signal: AbortSignal,
): Promise<Proposal | undefined> {
	const answer = await firstAnswer(models, signal, async (model) => {
		const reply = await registry
			.streamSimple(
				model,
				{
					systemPrompt: PROMPTS[moment],
					tools: [toolFor(moment)],
					messages: [{ role: "user", content, timestamp: Date.now() }],
				},
				{ signal },
			)
			.result();
		if (reply.stopReason === "error" || reply.stopReason === "aborted") return undefined;
		// An answer in words instead of a call is a model with nothing to change.
		const call = reply.content.find((part) => part.type === "toolCall" && part.name === TOOL);
		const args = call?.type === "toolCall" ? call.arguments : {};
		return { args, model: modelRef(model), usage: usageOf(reply.usage) };
	});
	if (answer === undefined) return undefined;
	const { step, ops } = answer.args;
	const proposed = [...(moment === "work" ? stepOf(step, state) : []), ...opsOf(ops, moment)];
	const checked = checkOps(proposed, moment, read, state);
	return { ...checked, model: answer.model, usage: answer.usage };
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

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PermissionConfig } from "#core/config/schema.ts";
import { createJudgeBackend } from "#core/judge/classifier.ts";
import { judgeToolCall } from "#core/judge/pipeline.ts";
import type { JudgeInput, JudgeOutcome } from "#core/judge/types.ts";
import type { CallDescriptor } from "#core/tools.ts";

export interface JudgeGateOptions {
	config: PermissionConfig;
	ctx: ExtensionContext;
	toolName: string;
	target: CallDescriptor;
	rawInput: unknown;
	/** Where the call comes from, when the tool name does not say it. */
	source?: string;
	toolDescription?: string;
	intent?: string;
	cache: Map<string, JudgeOutcome>;

	onStatus: (status: string | undefined) => void;
}

export async function judgeGate(options: JudgeGateOptions): Promise<JudgeOutcome | undefined> {
	const { config, ctx, toolName, target } = options;
	if (!ctx.hasUI && !config.judge.noUI) return undefined;

	const input: JudgeInput = {
		toolName,
		target,
		rawInput: options.rawInput,
		cwd: ctx.cwd,
		policy: config.judge.policy,
		source: options.source,
		toolDescription: options.toolDescription,
		intent: options.intent,
	};

	const key = cacheKey(config, input);
	if (config.judge.cache) {
		const cached = options.cache.get(key);
		if (cached) return cached;
	}

	const backend = createJudgeBackend(config.judge, ctx.modelRegistry);

	options.onStatus(`judge: considering ${toolName}`);
	let outcome: JudgeOutcome;
	try {
		outcome = await judgeToolCall({ config: config.judge, backend, input, signal: ctx.signal });
	} finally {
		options.onStatus(undefined);
	}

	if (config.judge.cache && outcome.record && outcome.record.error === undefined) {
		options.cache.set(key, outcome);
	}

	return outcome;
}

// The verdict depends on the intent. A call that serves one request may not serve the next.
function cacheKey(config: PermissionConfig, input: JudgeInput): string {
	return [
		config.judge.model,
		input.intent ?? "",
		input.toolName,
		input.target.summary,
		input.target.levels.join("\u0001"),
	].join("\u0000");
}

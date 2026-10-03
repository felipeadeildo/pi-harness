import type {
	ClassifierAnswer,
	ClassifierApi,
	ClassifierModel,
	ClassifierResult,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import type { JudgeConfig } from "#core/judge/config.ts";
import { buildJudgeQuestions, buildJudgeState } from "#core/judge/request.ts";
import {
	JudgeError,
	type JudgeAnswers,
	type JudgeBackend,
	type JudgeChoice,
	type JudgeChoiceAnswer,
	type JudgeUsage,
} from "#core/judge/types.ts";

export function createJudgeBackend(config: JudgeConfig, registry: ModelRegistry): JudgeBackend {
	const { model: reference, timeoutMs } = config;

	return {
		async assess(input, signal) {
			const started = Date.now();
			const model = findClassifier(registry, reference);
			if (!model) {
				throw new JudgeError(
					`"${reference}" is not a classifier model pi knows: pick another Model in Judge on Alt+S`,
					"no-model",
				);
			}

			const name = modelName(model);
			// Bounds pi's retries too.
			const timeout = AbortSignal.timeout(timeoutMs);
			const result = await registry.classify(
				model,
				{ state: buildJudgeState(input), questions: buildJudgeQuestions() },
				{ signal: AbortSignal.any([signal, timeout]), maxRetryDelayMs: timeoutMs },
			);

			if (signal.aborted) throw signal.reason ?? new Error("aborted");
			if (result.stopReason !== "stop") {
				if (timeout.aborted) {
					throw new JudgeError(
						`no answer from ${name} within ${timeoutMs}ms (check the network or proxy, or raise judge.timeoutMs)`,
						"timeout",
					);
				}
				throw new JudgeError(result.errorMessage ?? `${name} failed`, "model-error");
			}

			return {
				model: name,
				answers: toAnswers(result.answers),
				elapsedMs: Date.now() - started,
				usage: toUsage(result),
			};
		},
	};
}

// Splits at the first slash, since an id can hold its own. A bare id, as older settings saved it,
// takes the first classifier whose provider has a key.
export function findClassifier(
	registry: ModelRegistry,
	reference: string,
): ClassifierModel<ClassifierApi> | undefined {
	const trimmed = reference.trim();
	const slash = trimmed.indexOf("/");
	if (slash > 0) {
		return registry.findOfType("classifier", trimmed.slice(0, slash), trimmed.slice(slash + 1));
	}

	const matches = registry.getModelsOfType("classifier").filter((model) => model.id === trimmed);
	return (
		matches.find((model) => registry.getProviderAuthStatus(model.provider).configured) ?? matches[0]
	);
}

export function modelName(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

export function toAnswers(raw: Record<string, ClassifierAnswer>): JudgeAnswers {
	const { verdict, reversibility, sensitive_access: sensitive } = raw;
	return {
		verdict: verdict?.type === "choice" ? toVerdict(verdict.choice, verdict.confidence) : undefined,
		reversibility:
			reversibility?.type === "score" ? Math.min(2, Math.max(0, reversibility.score)) : undefined,
		sensitive_access: sensitive?.type === "bool" ? clamp01(sensitive.probability) : undefined,
	};
}

function toVerdict(choice: string, confidence: number): JudgeChoiceAnswer | undefined {
	return isJudgeChoice(choice) ? { choice, confidence: clamp01(confidence) } : undefined;
}

function isJudgeChoice(value: string): value is JudgeChoice {
	return value === "allow" || value === "deny" || value === "needs_human";
}

function toUsage(result: ClassifierResult): JudgeUsage | undefined {
	return result.usage ? { input: result.usage.input, output: result.usage.output } : undefined;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

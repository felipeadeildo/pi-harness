import { matchesPattern } from "#core/config/patterns.ts";
import type { JudgeConfig } from "#core/judge/config.ts";
import type { JudgeAnswers } from "#core/judge/types.ts";

export const RISK_WEIGHTS = {
	reversibility: 0.6,
	sensitive: 0.4,
} as const;

export function alwaysAskMatches(config: JudgeConfig, values: string[]): boolean {
	return config.alwaysAsk.some((pattern) => values.some((value) => matchesPattern(pattern, value)));
}

export function judgeRisk(answers: JudgeAnswers): number | undefined {
	const { reversibility, sensitive_access } = answers;
	if (reversibility === undefined || sensitive_access === undefined) return undefined;

	return (
		RISK_WEIGHTS.reversibility * clamp01(reversibility / 2) +
		RISK_WEIGHTS.sensitive * clamp01(sensitive_access)
	);
}

export type JudgeDecision = "allow" | "deny" | "uncertain";

export interface ComposedVerdict {
	decision: JudgeDecision;
	reason: string;
	risk?: number;
}

export function composeVerdict(config: JudgeConfig, answers: JudgeAnswers): ComposedVerdict {
	const verdict = answers.verdict;
	if (!verdict) return { decision: "uncertain", reason: "the judge gave no verdict" };

	if (verdict.choice === "needs_human")
		return { decision: "uncertain", reason: "the judge wants a person to decide" };

	if (verdict.choice === "deny") {
		if (!config.canDeny)
			return {
				decision: "uncertain",
				reason: `the judge said no, ${percent(verdict.confidence)} sure, and judge.canDeny is off`,
			};
		if (verdict.confidence >= config.thresholds.deny)
			return {
				decision: "deny",
				reason: `${percent(verdict.confidence)} sure`,
			};
		return {
			decision: "uncertain",
			reason: `the judge leaned no, only ${percent(verdict.confidence)} sure`,
		};
	}

	const risk = judgeRisk(answers);
	if (risk === undefined)
		return {
			decision: "uncertain",
			reason: "the judge gave no risk signals",
		};

	if (verdict.confidence < config.thresholds.allow)
		return {
			decision: "uncertain",
			reason: `the judge leaned yes, only ${percent(verdict.confidence)} sure`,
			risk,
		};

	if (risk > config.riskCeiling)
		return {
			decision: "uncertain",
			reason: `the judge said yes, but risk ${risk.toFixed(2)} is above ${config.riskCeiling.toFixed(2)}`,
			risk,
		};

	return {
		decision: "allow",
		reason: `${percent(verdict.confidence)} sure, risk ${risk.toFixed(2)}`,
		risk,
	};
}

function percent(value: number): string {
	return `${Math.round(clamp01(value) * 100)}%`;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

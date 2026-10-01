import { DEFAULT_POLICY } from "#core/judge/policy.ts";

export type JudgeBackendId = "jev" | "pi";

export type JudgeFallback = "ask" | "allow" | "deny";

export const JEV_MODELS = ["jev-latest", "jev-preview", "jev-1.13.0"];

export interface JudgeThresholds {
	allow: number;
	deny: number;
}

/** How much the judge must trust a call before it runs without you. */
export const JUDGE_RIGORS = ["cautious", "balanced", "relaxed"] as const;

export type JudgeRigor = (typeof JUDGE_RIGORS)[number];

export interface RigorRules {
	thresholds: JudgeThresholds;
	riskCeiling: number;
}

// In real sessions most calls the judge sent to the user were approvals it was 55 to 85% sure of.
// The risk ceiling decided almost none, so the levels move the allow threshold the most.
export const RIGOR: Record<JudgeRigor, RigorRules> = {
	cautious: { thresholds: { allow: 0.85, deny: 0.8 }, riskCeiling: 0.45 },
	balanced: { thresholds: { allow: 0.7, deny: 0.8 }, riskCeiling: 0.5 },
	relaxed: { thresholds: { allow: 0.55, deny: 0.8 }, riskCeiling: 0.6 },
};

export function describeRigor(rigor: JudgeRigor): string {
	const { thresholds, riskCeiling } = RIGOR[rigor];
	return `runs a call the judge approves at ${Math.round(thresholds.allow * 100)}% confidence or more, up to risk ${riskCeiling.toFixed(2)}`;
}

export const DEFAULT_RIGOR: JudgeRigor = "balanced";

export interface JudgeConfig {
	/** A Jev alias or pinned id, or `provider/modelId` for a pi model. */
	model: string;
	alwaysAsk: string[];
	thresholds: JudgeThresholds;
	riskCeiling: number;
	whenUnsure: JudgeFallback;
	canDeny: boolean;
	whenItFails: JudgeFallback;
	noUI: boolean;
	dryRun: boolean;
	rememberApprovals: boolean;
	timeoutMs: number;
	cache: boolean;
	policy: string;
}

export const DEFAULT_JUDGE: JudgeConfig = {
	model: "jev-latest",
	alwaysAsk: [],
	thresholds: { ...RIGOR[DEFAULT_RIGOR].thresholds },
	riskCeiling: RIGOR[DEFAULT_RIGOR].riskCeiling,
	whenUnsure: "ask",
	canDeny: true,
	whenItFails: "ask",
	noUI: false,
	dryRun: false,
	rememberApprovals: false,
	timeoutMs: 5000,
	cache: true,
	policy: DEFAULT_POLICY,
};

export function defaultJudge(): JudgeConfig {
	return {
		...DEFAULT_JUDGE,
		thresholds: { ...DEFAULT_JUDGE.thresholds },
		alwaysAsk: [...DEFAULT_JUDGE.alwaysAsk],
	};
}

/** A Jev name goes to TypeSafe. Any other model name is a pi model. */
export function judgeBackendOf(model: string): JudgeBackendId {
	return /^jev(-|$)/i.test(model.trim()) ? "jev" : "pi";
}

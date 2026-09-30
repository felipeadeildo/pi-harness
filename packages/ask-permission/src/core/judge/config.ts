import { DEFAULT_POLICY } from "#core/judge/policy.ts";

export type JudgeBackendId = "jev" | "pi";

export type JudgeFallback = "ask" | "allow" | "deny";

export interface JudgeThresholds {
	allow: number;
	deny: number;
}

export interface JudgeConfig {
	provider: JudgeBackendId;
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
	provider: "jev",
	model: "jev-latest",
	alwaysAsk: [],
	thresholds: { allow: 0.85, deny: 0.8 },
	riskCeiling: 0.45,
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

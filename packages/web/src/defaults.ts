// What the harness writes into pi-web-access's web-search.json. The numbers behind each choice are
// in docs/benchmark.md, and test/contract.test.ts runs them through the pinned version's own checks.

export interface WebDefault {
	key: string;
	value: unknown;
	why: string;
}

export const WEB_DEFAULTS: readonly WebDefault[] = [
	{
		key: "searchRouting",
		value: {
			providers: ["exa", "keenable", "parallel-mcp"],
			fallbackOn: ["transient", "quota", "network", "invalid-response", "empty"],
		},
		why: "Exa was the only provider with no off-topic link; Keenable is the fastest after it, and Parallel finds official pages",
	},
	{
		key: "fetchRouting",
		value: {
			providers: ["http", "jina", "parallel-mcp"],
			allowRemoteHostedProviders: true,
		},
		why: "the local reader misses pages that hide their text in scripts, such as gov.br, and Jina reads them without a key",
	},
];

export interface AnswerModel {
	provider: string;
	model: string;
}

/** The first one with a login answers `fetch_content` in answer mode; with none, the session's model does. */
export const ANSWER_MODELS: readonly AnswerModel[] = [
	{ provider: "deepseek", model: "deepseek-flash" },
	{ provider: "openai-codex", model: "gpt-6-luna" },
];

export const ANSWER_KEY = "fetch.answer";

import { join } from "node:path";

import { createApp, defineFeature, type FeatureScope } from "@adeildo/pi-kit";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import webAccess from "pi-web-access/dist/index.js";

import { applyDefaults, readDecided, webSearchConfigPath, writeDecided } from "./config.ts";
import { ANSWER_MODELS, type AnswerModel } from "./defaults.ts";
import { installedPackages, standaloneSource } from "./standalone.ts";

export { ANSWER_MODELS, WEB_DEFAULTS } from "./defaults.ts";

export interface WebOptions {
	/** Where the harness records which defaults it already wrote. */
	decidedPath?: string;
	configPath?: () => string;
	packages?: () => ReturnType<typeof installedPackages>;
	mount?: (pi: ExtensionAPI) => void;
}

export function webFeature(options: WebOptions = {}) {
	return defineFeature({
		id: "web",
		description: "Web search, page fetching and answers from a page, from pi-web-access",
		setup(scope) {
			const standalone = standaloneSource(
				(options.packages ?? (() => installedPackages(process.cwd())))(),
			);
			if (standalone === undefined) (options.mount ?? webAccess)(scope);
			const decidedPath =
				options.decidedPath ?? join(getAgentDir(), "extensions", "pi-harness", "web.json");
			scope.onSessionStart((ctx) =>
				setUp(scope, ctx, {
					decidedPath,
					configPath: (options.configPath ?? webSearchConfigPath)(),
					standalone,
				}),
			);
		},
	});
}

export const web = webFeature();

function setUp(
	scope: FeatureScope,
	ctx: ExtensionContext,
	where: { decidedPath: string; configPath: string; standalone: string | undefined },
): void {
	const applied = applyDefaults(where.configPath, where.decidedPath, answerModel(ctx));
	if (applied.error !== undefined) scope.warn(`${applied.error}, so its defaults were not written`);
	else if (applied.written.length > 0)
		ctx.ui.notify(
			`Web search set up in ${where.configPath}: ${applied.written.join(", ")}${applied.answer === undefined ? "" : ` (answers from ${applied.answer.provider}/${applied.answer.model})`}.`,
			"info",
		);

	if (where.standalone === undefined) return;
	const state = readDecided(where.decidedPath);
	if (state.toldStandalone === where.standalone) return;
	ctx.ui.notify(
		`pi-web-access is installed on its own (${where.standalone}), so the harness's pinned copy stays off. Remove it from your packages to use the pinned one.`,
		"info",
	);
	writeDecided(where.decidedPath, { ...state, toldStandalone: where.standalone });
}

function answerModel(ctx: ExtensionContext): AnswerModel | undefined {
	return ANSWER_MODELS.find((candidate) => {
		const model = ctx.modelRegistry?.find(candidate.provider, candidate.model);
		return model !== undefined && ctx.modelRegistry.hasConfiguredAuth(model);
	});
}

export default function piWeb(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-web" }).use(web).build();
}

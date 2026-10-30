// Pi's own section on its docs lists a page per topic and tells the model to read them all; every
// request carries it. The model finds the same pages from the index, so this says only where it is.
import { getDocsPath, getExamplesPath } from "@earendil-works/pi-coding-agent";

import type { Feature } from "../app/feature.ts";

export function piDocs(): Feature {
	return {
		id: "pi-docs",
		description: "Points the model at pi's documentation in a few words",
		setup(scope) {
			scope.on("before_agent_start", (event) => {
				if (event.systemPromptOptions.customPrompt) return;
				event.systemPromptOptions.sections.docs = docsSection();
			});
		},
	};
}

export function docsSection(): string {
	return `For questions about pi itself, or work that builds on it (settings, extensions, skills, SDK, TUI), pi's documentation starts at ${getDocsPath()}/index.md, which links every page, with examples in ${getExamplesPath()}. Read the pages that apply in full, following their links, before you answer or build.`;
}

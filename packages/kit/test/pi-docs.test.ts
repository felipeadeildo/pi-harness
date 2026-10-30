import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { getDocsPath } from "@earendil-works/pi-coding-agent";

import { createApp } from "../src/app/builder.ts";
import { docsSection, piDocs } from "../src/pi-docs/feature.ts";
import { fakeContext, fakePi } from "../src/testing.ts";

async function docsAfterStart(customPrompt?: string) {
	const fake = fakePi();
	createApp(fake.pi, { name: "test" }).use(piDocs()).build();
	const options = { customPrompt, sections: {} as Record<string, string> };
	await fake.fire("before_agent_start", { systemPromptOptions: options }, fakeContext());
	return options.sections.docs;
}

test("pi's section on its docs is replaced by one that points at the index", async () => {
	expect(await docsAfterStart()).toBe(docsSection());
});

test("the index it points at is a page pi ships", () => {
	expect(existsSync(join(getDocsPath(), "index.md"))).toBe(true);
	expect(docsSection()).toContain(join(getDocsPath(), "index.md"));
});

test("a custom prompt, which leaves pi's docs section out, does not get one back", async () => {
	expect(await docsAfterStart("You review SQL.")).toBeUndefined();
});

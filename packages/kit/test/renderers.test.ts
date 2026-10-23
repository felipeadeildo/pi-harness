import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MessageRenderer, ToolRenderers } from "@earendil-works/pi-coding-agent";

import {
	createApp,
	defineFeature,
	messageRendererFor,
	resolveToolRenderers,
} from "../src/index.ts";
import { fakePi } from "../src/testing.ts";

const settingsPath = join(mkdtempSync(join(tmpdir(), "pi-kit-renderers-")), "settings.json");

/** A renderer that says which features wrapped it, outermost first. */
function wrapping(name: string) {
	return defineFeature({
		id: name,
		description: name,
		setup(scope) {
			scope.registerToolRenderer((tool, next) => ({
				...next(),
				label: `${name}(${(next() as { label?: string } | undefined)?.label ?? tool})`,
			}));
		},
	});
}

function labelOf(renderers: ToolRenderers | undefined): string | undefined {
	return (renderers as { label?: string } | undefined)?.label;
}

test("a tool's renderers resolve through every feature, in the order pi resolves them", () => {
	const { pi } = fakePi();
	createApp(pi, { name: "test", settingsPath })
		.use(wrapping("outer"))
		.use(wrapping("inner"))
		.build();
	const base = { label: "base" } as ToolRenderers;
	expect(labelOf(resolveToolRenderers("bash", () => base))).toBe("outer(inner(base))");
});

test("a feature mounted again for the next session replaces what it registered", () => {
	for (let session = 0; session < 2; session++) {
		const { pi } = fakePi();
		createApp(pi, { name: "test", settingsPath }).use(wrapping("again")).build();
	}
	const base = { label: "base" } as ToolRenderers;
	expect(labelOf(resolveToolRenderers("bash", () => base))).toContain("again(base)");
	expect(labelOf(resolveToolRenderers("bash", () => base))).not.toContain("again(again(");
});

const NOTE_RENDERER: MessageRenderer = () => undefined;

test("a custom message type's renderer is the one a feature registered", () => {
	const { pi } = fakePi();
	createApp(pi, { name: "test", settingsPath })
		.use(
			defineFeature({
				id: "notes",
				description: "notes",
				setup: (scope) => scope.registerMessageRenderer("note", NOTE_RENDERER),
			}),
		)
		.build();
	expect(messageRendererFor("note")).toBe(NOTE_RENDERER);
	expect(messageRendererFor("nobody")).toBeUndefined();
});

import { describe, expect, test } from "bun:test";

import { fakePi, fakeScope } from "@adeildo/pi-kit/testing";
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";

import { asking, settle } from "#core/ruling.ts";
import { createSession } from "#pi/session.ts";
import { registerRulingLine, restoreRulings, showRuling } from "#ui/ruling-line.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

describe("settle", () => {
	test("you answering keeps why you were asked", () => {
		const asked = asking("the judge wants a person to decide", "99%");
		expect(settle({ action: "block", by: "you", note: "use pnpm" }, asked)).toEqual({
			tone: "error",
			head: "you said no",
			why: "asked because the judge wants a person to decide",
			note: "use pnpm",
			detail: "99%",
		});
	});

	test("the judge's own words say why it approved", () => {
		const judged = {
			tone: "pending" as const,
			head: "judging",
			why: "97% sure, risk 0.12",
		};
		expect(settle({ action: "allow", by: "judge" }, judged)).toMatchObject({
			head: "judge approved",
			why: "97% sure, risk 0.12",
		});
	});

	test("a rule that lets a read through says nothing, and a block always says why", () => {
		expect(settle({ action: "allow", by: "allow list" }, undefined)).toBeUndefined();
		expect(settle({ action: "allow", by: "read-only bash" }, undefined)).toBeUndefined();
		expect(
			settle({ action: "block", by: "workspace", reason: "pi-ask-permission: outside" }, undefined),
		).toEqual({ tone: "error", head: "blocked", why: "outside" });
	});
});

function render(component: Component): string {
	return component
		.render(120)
		.map((line) => line.trimEnd())
		.join("\n");
}

describe("the line on the call", () => {
	function setup() {
		const pi = fakePi();
		const state = createSession();
		const scope = fakeScope({ pi });
		registerRulingLine(scope, state);
		const resolver = pi.toolRenderers[0];
		if (resolver === undefined) throw new Error("no tool renderer");
		const seen: (Component | undefined)[] = [];
		const renderers = resolver("bash", () => ({
			renderCall: (args: unknown, _theme, context) => {
				seen.push(context.lastComponent);
				return new Text(`$ ${(args as { command: string }).command}`, 0, 0);
			},
		}));
		let redrawn = 0;
		const context = (lastComponent?: Component) =>
			({
				toolCallId: "call-1",
				invalidate: () => void redrawn++,
				lastComponent,
				expanded: false,
			}) as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
		const draw = (lastComponent?: Component) => {
			const component = renderers?.renderCall?.(
				{ command: "npm install" },
				theme,
				context(lastComponent),
			);
			if (component === undefined) throw new Error("no component");
			return component;
		};
		return { state, scope, draw, seen, redrawn: () => redrawn };
	}

	test("sits under the command, and redraws when the ruling changes", () => {
		const { state, scope, draw, redrawn } = setup();
		expect(render(draw())).toBe("$ npm install");

		showRuling(scope, state, "call-1", asking("the judge leaned no, only 61% sure"));
		expect(redrawn()).toBe(1);
		expect(render(draw())).toBe("$ npm install\n◈ asking you  the judge leaned no, only 61% sure");
	});

	test("the tool's own renderer gets back the component it drew", () => {
		const { state, scope, draw, seen } = setup();
		showRuling(scope, state, "call-1", asking());
		const first = draw();
		draw(first);
		expect(seen[1]).toBeInstanceOf(Text);
		expect(seen[1]).not.toBe(first);
	});

	test("a resumed session shows the rulings it kept", () => {
		const { state, draw } = setup();
		const entry = {
			type: "custom",
			customType: "pi-ask-permission:ruling",
			data: { toolCallId: "call-1", tone: "success", head: "judge approved", why: "97% sure" },
		};
		restoreRulings(state, { sessionManager: { getBranch: () => [entry] } } as never);
		expect(render(draw())).toBe("$ npm install\n◈ judge approved  97% sure");
	});
});

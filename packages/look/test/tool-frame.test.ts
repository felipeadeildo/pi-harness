import { describe, expect, test } from "bun:test";

import { createApp, RULING, type RulingRequest } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import type { AgentToolResult, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

import { look } from "../src/index.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

/** Pi's own order: each resolver asks the next one, and the tool definition comes last. */
function resolve(fake: ReturnType<typeof fakePi>, base: ToolRenderers, toolName = "bash") {
	const resolveAt = (index: number): ToolRenderers | undefined =>
		index < fake.toolRenderers.length
			? fake.toolRenderers[index]!(toolName, () => resolveAt(index + 1))
			: base;
	return resolveAt(0);
}

function renderers(): ToolRenderers {
	return {
		renderCall: (args: unknown) => new Text(`$ ${(args as { command: string }).command}`, 0, 0),
		renderResult: () => {
			const box = new Container();
			box.addChild(new Text("583 pass", 0, 0));
			return box;
		},
	};
}

function toolResult(): AgentToolResult<undefined> {
	return { content: [{ type: "text", text: "583 pass" }], details: undefined };
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		toolCallId: "call-1",
		invalidate: () => {},
		state: {},
		expanded: false,
		isPartial: false,
		isError: false,
		executionStarted: true,
		cwd: "/repo",
		...overrides,
	} as never;
}

function framed(ruling?: RulingRequest["ruling"], toolName = "bash") {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	fake.pi.events.on(RULING, (data) => {
		if ((data as RulingRequest).toolCallId === "call-1") (data as RulingRequest).ruling = ruling;
	});
	const chain = resolve(fake, renderers(), toolName);
	if (chain === undefined) throw new Error("no renderers");
	const call = chain.renderCall?.({ command: "bun run test" }, theme, context());
	if (call === undefined) throw new Error("no call component");
	return { chain, call: call.render(60).map((line) => line.trimEnd()) };
}

describe("the frame around a tool call", () => {
	test("opens with the tool's mark and name", () => {
		const { call } = framed();
		expect(call[0]).toMatch(/^\u256d\u2500 \S+ bash \u2500+\u256e$/);
		expect(call[1]).toMatch(/^\u2502 \$ bun run test +\u2502$/);
	});

	test("says the ruling under the call, when there is one", () => {
		const { call } = framed({ tone: "success", head: "judge approved", why: "97% sure" });
		expect(call[2]).toContain("\u25c8 judge approved  97% sure");
	});

	test("closes with the mark of how it went", () => {
		const { chain } = framed();
		const result = chain.renderResult?.(
			toolResult(),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const lines = (result ?? new Text("", 0, 0)).render(60).map((line) => line.trimEnd());
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ \u2500+\u256f$/);
	});

	test("hands a tool it cannot frame back to pi, untouched", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const partial = { renderCall: () => new Text("mine", 0, 0) };
		expect(resolve(fake, partial)).toBe(partial);
	});
});

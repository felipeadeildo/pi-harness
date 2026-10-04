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

function toolResult(text = "583 pass"): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

function plain(component: { render(width: number): string[] }): string[] {
	return component.render(60).map((line) => line.trimEnd());
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

/** A call and its result share one context, which is where the frame keeps the clock. */
function whole(ruling?: RulingRequest["ruling"], output = "583 pass") {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	fake.pi.events.on(RULING, (data) => {
		if ((data as RulingRequest).toolCallId === "call-1") (data as RulingRequest).ruling = ruling;
	});
	const chain = resolve(fake, { ...renderers(), renderResult: () => new Text(output, 0, 0) });
	if (chain === undefined) throw new Error("no renderers");

	// The clock of a call the model took 2.1s to write and that ran for 6.8s.
	const shared = context({
		argsComplete: true,
		state: { writingAt: 1_000, writtenAt: 3_100, startedAt: 4_000, endedAt: 10_800 },
	});
	const call = chain.renderCall?.({ command: "bun run test" }, theme, shared);
	if (call === undefined) throw new Error("no call component");
	const result = chain.renderResult?.(
		toolResult(),
		{ expanded: false, isPartial: false },
		theme,
		shared,
	);
	if (result === undefined) throw new Error("no result component");
	return { call: plain(call), result: plain(result) };
}

function framed(
	ruling?: RulingRequest["ruling"],
	toolName = "bash",
	overrides: Record<string, unknown> = {},
) {
	const fake = fakePi();
	createApp(fake.pi, { name: "look" }).use(look).build();
	fake.pi.events.on(RULING, (data) => {
		if ((data as RulingRequest).toolCallId === "call-1") (data as RulingRequest).ruling = ruling;
	});
	const chain = resolve(fake, renderers(), toolName);
	if (chain === undefined) throw new Error("no renderers");
	const call = chain.renderCall?.({ command: "bun run test" }, theme, context(overrides));
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
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ done \u2500+\u256f$/);
	});

	test("cuts the command off from what it printed", () => {
		const { call, result } = whole();
		expect(call.some((line) => /^\u251c\u2500+\u2524$/u.test(line))).toBe(false);
		expect(result[0]).toMatch(/^\u251c\u2500+\u2524$/);
	});

	test("leaves the cut out of a call with nothing to print", () => {
		const { result } = whole(undefined, "");
		expect(result.some((line) => /^\u251c\u2500+\u2524$/u.test(line))).toBe(false);
		expect(result.at(-1)).toMatch(/^\u2570\u2500 \S+ done  6\.8s  wrote 2\.1s \u2500+\u256f$/);
	});

	test("says the times on the bottom rule instead of inside the output", () => {
		const { result } = whole(undefined, "583 pass\n\nTook 6.8s");
		expect(result.some((line) => line.includes("Took"))).toBe(false);
		expect(result.at(-1)).toMatch(/^\u2570\u2500 \S+ done  6\.8s  wrote 2\.1s \u2500+\u256f$/);
	});

	test("says the phase while the call has nothing to show yet", () => {
		const writing = framed(undefined, "bash", { executionStarted: false, argsComplete: false });
		expect(writing.call.at(-1)).toMatch(/^\u2570\u2500 \S+ writing  0\.0s \u2500+\u256f$/);

		const waiting = framed(undefined, "bash", { executionStarted: false, argsComplete: true });
		expect(waiting.call.at(-1)).toMatch(/^\u2570\u2500 \S+ waiting  0\.0s \u2500+\u256f$/);

		// Once it runs, the result half owns the bottom rule and this one stops drawing it.
		const running = framed(undefined, "bash", { executionStarted: true });
		expect(running.call.some((line) => /\u2570\u2500/u.test(line))).toBe(false);
	});

	test("closes a call that is still running with the time so far", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, renderers());
		if (chain === undefined) throw new Error("no renderers");
		const shared = context({ state: { startedAt: Date.now() - 3_200 } });
		chain.renderCall?.({ command: "bun run test" }, theme, shared);
		const result = chain.renderResult?.(
			toolResult(),
			{ expanded: false, isPartial: true },
			theme,
			shared,
		);
		const lines = (result ?? new Text("", 0, 0)).render(60).map((line) => line.trimEnd());
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ running  3\.2s \u2500+\u256f$/);
	});

	test("counts the pictures pi draws below the frame", () => {
		const { chain } = framed();
		const result = chain.renderResult?.(
			{
				content: [{ type: "image", data: "x", mimeType: "image/png" }],
				details: undefined,
			} as never,
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const lines = result === undefined ? [] : plain(result);
		expect(lines.at(-1)).toContain("with 1 image");
	});

	test("frames a tool that brings no renderers of its own", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, {}, "memory_read");
		if (chain === undefined) throw new Error("no renderers");

		const call = chain.renderCall?.({ target: "scratchpad" }, theme, context());
		const callLines = call === undefined ? [] : plain(call);
		expect(callLines[0]).toMatch(/^\u256d\u2500 \S+ memory_read \u2500+\u256e$/);
		expect(callLines[1]).toContain('memory_read target="scratchpad"');

		const result = chain.renderResult?.(
			toolResult("# Scratchpad"),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const lines = result === undefined ? [] : plain(result);
		expect(lines.some((line) => line.includes("# Scratchpad"))).toBe(true);
		expect(lines.at(-1)).toMatch(/^\u2570\u2500 \S+ done \u2500+\u256f$/);
	});

	test("keeps the half a tool brings, and stands in for the other", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, { renderCall: () => new Text("mine", 0, 0) }, "memory_read");
		if (chain === undefined) throw new Error("no renderers");

		const call = chain.renderCall?.({ target: "scratchpad" }, theme, context());
		expect(call === undefined ? [] : plain(call)).toContainEqual(expect.stringContaining("mine"));

		const result = chain.renderResult?.(
			toolResult(),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		expect(result === undefined ? [] : plain(result)).toContainEqual(
			expect.stringContaining("583 pass"),
		);
	});

	test("shortens a long result, and shows it all when expanded", () => {
		const fake = fakePi();
		createApp(fake.pi, { name: "look" }).use(look).build();
		const chain = resolve(fake, {}, "memory_read");
		if (chain === undefined) throw new Error("no renderers");
		const output = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join("\n");

		const collapsed = chain.renderResult?.(
			toolResult(output),
			{ expanded: false, isPartial: false },
			theme,
			context(),
		);
		const collapsedLines = collapsed === undefined ? [] : plain(collapsed);
		expect(collapsedLines.some((line) => line.includes("line 14"))).toBe(false);
		expect(collapsedLines.some((line) => line.includes("4 more lines"))).toBe(true);

		const expanded = chain.renderResult?.(
			toolResult(output),
			{ expanded: true, isPartial: false },
			theme,
			context(),
		);
		const expandedLines = expanded === undefined ? [] : plain(expanded);
		expect(expandedLines.some((line) => line.includes("line 14"))).toBe(true);
		expect(expandedLines.some((line) => line.includes("more lines"))).toBe(false);
	});
});

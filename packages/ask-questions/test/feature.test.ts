import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@adeildo/pi-kit";
import { type FakePi, fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import type {
	ExtensionContext,
	ExtensionToolContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { questions } from "../src/index.ts";
import { TOOL_NAME } from "../src/schema.ts";

let dir: string;
let settingsPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-ask-questions-"));
	settingsPath = join(dir, "settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Mounted {
	fake: FakePi;
	tool: ToolDefinition;
	active: string[];
}

async function mounted(ctx: ExtensionContext, active: string[] = [TOOL_NAME]): Promise<Mounted> {
	const fake = fakePi();
	const state = { active };
	Object.assign(fake.pi, {
		getActiveTools: () => state.active,
		setActiveTools: (names: string[]) => {
			state.active = names;
		},
	});
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);
	const tool = fake.tools.find((entry) => entry.name === TOOL_NAME);
	if (tool === undefined) throw new Error("the tool was not registered");
	return {
		fake,
		tool,
		get active() {
			return state.active;
		},
	};
}

function agentStart(guidelines: Record<string, string[]> = {}) {
	return {
		type: "before_agent_start",
		prompt: "",
		systemPromptOptions: { toolGuidelines: guidelines },
	};
}

// A tool's context adds the nested-call API, which this tool never uses.
function run(tool: ToolDefinition, params: unknown, ctx: ExtensionContext) {
	return tool.execute("1", params, undefined, undefined, ctx as ExtensionToolContext);
}

const PARAMS = {
	questions: [
		{
			question: "Which?",
			header: "Pick",
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		},
	],
};

test("the tool asks the user, so scripts never call it and the permission gate lets it be", async () => {
	const { tool } = await mounted(fakeContext());
	expect(tool.exposure).toBe("model-only");
	expect(tool.annotations?.readOnlyHint).toBe(true);
});

test("with no UI the tool leaves the model's list, and comes back with one", async () => {
	const noUI = fakeContext([], false);
	const session = await mounted(noUI, ["read", TOOL_NAME]);
	await session.fake.fire("before_agent_start", agentStart(), noUI);
	expect(session.active).toEqual(["read"]);

	await session.fake.fire("before_agent_start", agentStart(), fakeContext());
	expect(session.active).toEqual(["read", TOOL_NAME]);
});

test("your own guidance joins the tool's guidelines", async () => {
	writeFileSync(
		settingsPath,
		JSON.stringify({ questions: { guidance: "Always show a preview." } }),
	);
	const ctx = fakeContext();
	const { fake } = await mounted(ctx);
	const guidelines = { [TOOL_NAME]: ["built in"] };
	await fake.fire("before_agent_start", agentStart(guidelines), ctx);
	expect(guidelines[TOOL_NAME]).toEqual(["built in", "Always show a preview."]);
});

test("no guidance leaves the prompt as it was", async () => {
	const ctx = fakeContext();
	const { fake } = await mounted(ctx);
	const guidelines = { [TOOL_NAME]: ["built in"] };
	await fake.fire("before_agent_start", agentStart(guidelines), ctx);
	expect(guidelines[TOOL_NAME]).toEqual(["built in"]);
});

test("questions that cannot be asked fail the call", async () => {
	const ctx = fakeContext();
	const { tool } = await mounted(ctx);
	const reserved = {
		questions: [
			{
				...PARAMS.questions[0]!,
				options: [
					{ label: "Other", description: "" },
					{ label: "B", description: "" },
				],
			},
		],
	};
	await expect(run(tool, reserved, ctx)).rejects.toThrow("reserved");
});

test("the answer from the dialog is the result's details", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const answer = {
		cancelled: false,
		answers: [{ question: "Which?", header: "Pick", picked: ["B"], notes: [] }],
	};
	const ctx = fakeContext([], true, { ui: { custom: async () => answer } });
	const { tool } = await mounted(ctx);
	const result = await run(tool, PARAMS, ctx);
	expect(result.details).toEqual(answer);
	expect(result.content).toEqual([
		{
			type: "text",
			text: 'The user answered:\n- Pick: "Which?" → "B"\nContinue with these answers in mind.',
		},
	]);
});

test("over RPC the questions go through the host's own dialogs", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const ctx = fakeContext([], true, {
		mode: "rpc",
		ui: { select: async () => "1. A: a", input: async () => undefined },
	});
	const { tool } = await mounted(ctx);
	const result = await run(tool, PARAMS, ctx);
	expect(result.details).toMatchObject({ cancelled: false, answers: [{ picked: ["A"] }] });
});

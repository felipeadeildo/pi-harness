import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ASK, ANSWER, type AskRequest, canAsk, createApp } from "@adeildo/pi-kit";
import { type FakePi, fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import { createEventBus, initTheme } from "@earendil-works/pi-coding-agent";
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

// The dialog draws its editor with pi's theme.
beforeAll(() => initTheme("dark", false));

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

test("another package asks through the same dialog", async () => {
	const answer = {
		answers: [{ question: "Which?", header: "Pick", picked: ["A"], notes: [] }],
		cancelled: false,
	};
	const bus = createEventBus();
	const fake = fakePi(bus);
	const ctx = fakeContext([], true, { ui: { custom: async () => answer } });
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);

	expect(canAsk(bus)).toBe(true);
	const request: AskRequest = {
		id: "ask-1",
		questions: [{ header: "Pick", question: "Which?", options: [{ label: "A" }] }],
	};
	const answered = new Promise<unknown>((resolve) => {
		bus.on(ANSWER, (data: unknown) => resolve(data));
	});
	bus.emit(ASK, request);
	expect(answered).resolves.toEqual({ id: "ask-1", result: answer });
});

test("with no session nothing is available, and a request is left alone", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	expect(canAsk(bus)).toBe(false);
	let seen = 0;
	bus.on(ANSWER, () => void seen++);
	bus.emit(ASK, { id: "ask-1", questions: [] });
	await Promise.resolve();
	expect(seen).toBe(0);
});

test("a request that does not decode is answered with the reason", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, fakeContext());

	const answered = new Promise<{ result: { error?: string; cancelled: boolean } }>((resolve) => {
		bus.on(ANSWER, (data: unknown) => resolve(data as never));
	});
	bus.emit(ASK, { id: "ask-1", questions: [{ header: "Pick", question: "Which?" }] });
	const { result } = await answered;
	expect(result.cancelled).toBe(true);
	expect(result.error).toContain("did not decode");
});

test("a dialog that throws still answers the asker", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const ctx = fakeContext([], true, {
		ui: {
			custom: async () => {
				throw new Error("boom");
			},
		},
	});
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);

	const answered = new Promise<{ result: { error?: string } }>((resolve) => {
		bus.on(ANSWER, (data: unknown) => resolve(data as never));
	});
	bus.emit(ASK, {
		id: "ask-1",
		questions: [{ header: "Pick", question: "Which?", options: [{ label: "A" }] }],
	});
	expect((await answered).result.error).toContain("boom");
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("two asks at once draw one after the other, since pi strands a replaced dialog", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const open: ((result: unknown) => void)[] = [];
	const ctx = fakeContext([], true, {
		ui: { custom: () => new Promise((resolve) => open.push(resolve)) },
	});
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);

	const answered: string[] = [];
	bus.on(ANSWER, (data: unknown) => void answered.push((data as { id: string }).id));
	const ask = (id: string) =>
		bus.emit(ASK, {
			id,
			questions: [{ header: "Pick", question: "Which?", options: [{ label: "A" }] }],
		});

	ask("ask-1");
	ask("ask-2");
	await tick();
	expect(open).toHaveLength(1);

	open[0]!({ answers: [], cancelled: true });
	await tick();
	expect(answered).toEqual(["ask-1"]);
	expect(open).toHaveLength(2);

	open[1]!({ answers: [], cancelled: true });
	await tick();
	expect(answered).toEqual(["ask-1", "ask-2"]);
});

test("the model's questions open once you stop typing in the editor", async () => {
	writeFileSync(
		settingsPath,
		JSON.stringify({ questions: { bell: false, typing: { pause: 40 } } }),
	);
	let type: ((data: string) => void) | undefined;
	const statuses: (string | undefined)[] = [];
	let openedAt = 0;
	const ctx = fakeContext([], true, {
		ui: {
			onTerminalInput: (handler: (data: string) => void) => {
				type = handler;
				return () => {};
			},
			setStatus: (_key: string, text: string | undefined) => statuses.push(text),
			custom: async () => {
				openedAt = Date.now();
				return { answers: [], cancelled: true };
			},
		},
	});
	const { tool } = await mounted(ctx);

	type?.("a");
	const typedAt = Date.now();
	await run(tool, PARAMS, ctx);

	expect(openedAt - typedAt).toBeGreaterThanOrEqual(35);
	expect(statuses).toEqual(["waiting for you to finish typing", undefined]);
});

function streaming(id: string, args: unknown, done = false) {
	const toolCall = { type: "toolCall", id, name: TOOL_NAME, arguments: args };
	const assistantMessageEvent = done
		? { type: "toolcall_end", contentIndex: 0, toolCall }
		: { type: "toolcall_delta", contentIndex: 0, delta: "", partial: { content: [toolCall] } };
	return { type: "message_update", message: { role: "assistant" }, assistantMessageEvent };
}

interface Opened {
	update: (questions: unknown[], writing: boolean) => void;
	close: () => void;
}

/** A ctx whose dialog records what the stream fed it, and answers when told to. */
function liveContext() {
	const seen: { questions: number; writing: boolean }[] = [];
	const results: unknown[] = [];
	let answer: ((result: unknown) => void) | undefined;
	let opened = 0;
	const ctx = fakeContext([], true, {
		ui: {
			custom: (factory: (...args: unknown[]) => Opened) =>
				new Promise((resolve) => {
					opened++;
					const done = (result: unknown) => {
						results.push(result);
						resolve(result);
					};
					answer = done;
					const dialog = factory(
						{ requestRender: () => {}, terminal: { rows: 40, columns: 100 } },
						{ fg: (_: string, text: string) => text, bg: (_: string, text: string) => text },
						{ matches: () => false },
						done,
					);
					const update = dialog.update.bind(dialog);
					dialog.update = (asked, writing) => {
						seen.push({ questions: asked.length, writing });
						update(asked, writing);
					};
				}),
		},
	});
	return {
		ctx,
		seen,
		results,
		opened: () => opened,
		answer: (result: unknown) => answer?.(result),
	};
}

test("the dialog opens while the model writes, and the tool waits on the same answer", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const live = liveContext();
	const { fake, tool } = await mounted(live.ctx);
	const first = PARAMS.questions[0]!;
	const params = { questions: [first, { ...first, question: "Again?" }] };

	await fake.fire(
		"message_update",
		streaming("call", { questions: [{ question: "Wh" }] }),
		live.ctx,
	);
	await tick();
	expect(live.opened()).toBe(1);

	await fake.fire(
		"message_update",
		streaming("call", { questions: [first, { question: "And" }] }),
		live.ctx,
	);
	await fake.fire("message_update", streaming("call", params, true), live.ctx);
	expect(live.seen).toEqual([
		{ questions: 2, writing: true },
		{ questions: 2, writing: false },
	]);

	const running = tool.execute(
		"call",
		params,
		undefined,
		undefined,
		live.ctx as ExtensionToolContext,
	);
	const answer = {
		cancelled: false,
		answers: [{ question: "Which?", header: "Pick", picked: ["A"], notes: [] }],
	};
	live.answer(answer);
	expect((await running).details).toEqual(answer);
	expect(live.opened()).toBe(1);
});

test("a call that never runs closes the dialog it opened", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const live = liveContext();
	const { fake } = await mounted(live.ctx);

	await fake.fire(
		"message_update",
		streaming("call", { questions: [{ question: "Which?" }] }),
		live.ctx,
	);
	await tick();
	await fake.fire(
		"tool_execution_end",
		{ type: "tool_execution_end", toolCallId: "call" },
		live.ctx,
	);
	expect(live.results).toEqual([{ answers: [], cancelled: true }]);
	await fake.fire(
		"message_update",
		streaming("call", { questions: [{ question: "Which?" }] }, true),
		live.ctx,
	);
	expect(live.seen).toEqual([]);
});

test("a stream that breaks mid-call never takes back a question or leaves the dialog open", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const live = liveContext();
	const { fake } = await mounted(live.ctx);
	const first = PARAMS.questions[0]!;
	const fire = (args: unknown, done = false) =>
		fake.fire("message_update", streaming("call", args, done), live.ctx);

	await fire({ questions: [first, { question: "Next?" }] });
	await tick();
	// A delta that no longer parses comes back as `{}`, or with fewer questions: both are skipped.
	await fire({});
	await fire({ questions: [first] });
	await fire("not an object");
	await fire({ questions: [first, { question: "Next?", options: [{ label: 7 }, null] }] });
	expect(live.seen).toEqual([{ questions: 2, writing: true }]);
	expect(live.results).toEqual([]);

	// The reply ends without finishing the call, as on an abort, an error or the token limit.
	await fake.fire("turn_end", { type: "turn_end", toolResults: [] }, live.ctx);
	expect(live.results).toEqual([{ answers: [], cancelled: true }]);
});

test("arguments that never parse close the dialog when the call ends", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const live = liveContext();
	const { fake } = await mounted(live.ctx);

	await fake.fire(
		"message_update",
		streaming("call", { questions: [{ question: "Which?" }] }),
		live.ctx,
	);
	await tick();
	// Pi hands malformed JSON over as `{}` once the call is finished.
	await fake.fire("message_update", streaming("call", {}, true), live.ctx);
	expect(live.results).toEqual([{ answers: [], cancelled: true }]);
});

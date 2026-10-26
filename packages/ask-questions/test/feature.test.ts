import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ASK,
	ANSWER,
	type AskRequest,
	askQuestions,
	CANCEL,
	canAsk,
	createApp,
	type EventScope,
	type LoggedEvent,
	logPath,
	readFrom,
	NAMES,
	targetOf,
} from "@adeildo/pi-kit";
import { type FakePi, fakeContext, fakePi, fakeTerminal } from "@adeildo/pi-kit/testing";
import { createEventBus, initTheme } from "@earendil-works/pi-coding-agent";
import type {
	ExtensionContext,
	ExtensionToolContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { questions } from "../src/index.ts";
import { TOOL_NAME } from "../src/schema.ts";

let dir: string;
let settingsPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-ask-questions-"));
	settingsPath = join(dir, "settings.json");
	process.env.PI_HARNESS_EVENTS = join(dir, "events");
});

afterEach(() => {
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(dir, { recursive: true, force: true });
});

const SESSION = {
	getCwd: () => "/home/me/repo",
	getSessionId: () => "0123456789abcdef",
	getSessionName: () => undefined,
};

/** A session with a log, since the tool's questions are logged. */
function context(...[notes, hasUI, extra = {}]: Parameters<typeof fakeContext>): ExtensionContext {
	return fakeContext(notes, hasUI, { sessionManager: SESSION, ...extra });
}

const SLOT = "pi-kit:above-editor";
const ENTER = "\r";
const DOWN = "\u001b[B";
const ESC = "\u001b";

const PICKED_A = {
	cancelled: false,
	answers: [{ question: "Which?", header: "Pick", picked: ["A"], notes: [] }],
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A context with a terminal, whose dialogs a test answers by pressing the keys a reader would. */
function terminalContext(extra: Record<string, unknown> = {}) {
	const ctx = context([], true, extra);
	return { ctx, term: fakeTerminal(ctx) };
}

type Term = ReturnType<typeof fakeTerminal>;

/** Waits until the terminal has drawn the dialog, which opens once the reader stops typing. */
async function drawn(term: Term, count = 1): Promise<void> {
	for (let wait = 0; term.built < count && wait < 200; wait++) await tick();
	if (term.built < count) throw new Error("the dialog was not drawn");
}

/** What the dialog above the editor shows, without the colors. */
function seen(term: Term): string {
	// oxlint-disable-next-line no-control-regex
	return (term.draw(SLOT) ?? []).join("\n").replace(/\u001b\[[0-9;]*m/g, "");
}

// The dialog draws its editor with pi's theme.
beforeAll(() => initTheme("dark", false));

interface Mounted {
	fake: FakePi;
	tool: ToolDefinition;
	active: string[];
}

async function mounted(
	ctx: ExtensionContext,
	active: string[] = [TOOL_NAME],
	bus = createEventBus(),
): Promise<Mounted> {
	const fake = fakePi(bus);
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
	const { tool } = await mounted(context());
	expect(tool.exposure).toBe("model-only");
	expect(tool.annotations?.readOnlyHint).toBe(true);
});

test("with no UI the tool leaves the model's list, and comes back with one", async () => {
	const noUI = context([], false);
	const session = await mounted(noUI, ["read", TOOL_NAME]);
	await session.fake.fire("before_agent_start", agentStart(), noUI);
	expect(session.active).toEqual(["read"]);

	await session.fake.fire("before_agent_start", agentStart(), context());
	expect(session.active).toEqual(["read", TOOL_NAME]);
});

test("your own guidance joins the tool's guidelines", async () => {
	writeFileSync(
		settingsPath,
		JSON.stringify({ questions: { guidance: "Always show a preview." } }),
	);
	const ctx = context();
	const { fake } = await mounted(ctx);
	const guidelines = { [TOOL_NAME]: ["built in"] };
	await fake.fire("before_agent_start", agentStart(guidelines), ctx);
	expect(guidelines[TOOL_NAME]).toEqual(["built in", "Always show a preview."]);
});

test("no guidance leaves the prompt as it was", async () => {
	const ctx = context();
	const { fake } = await mounted(ctx);
	const guidelines = { [TOOL_NAME]: ["built in"] };
	await fake.fire("before_agent_start", agentStart(guidelines), ctx);
	expect(guidelines[TOOL_NAME]).toEqual(["built in"]);
});

test("questions that cannot be asked fail the call", async () => {
	const ctx = context();
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
	const { ctx, term } = terminalContext();
	const { tool } = await mounted(ctx);
	const running = run(tool, PARAMS, ctx);
	await drawn(term);
	term.press(DOWN, ENTER);
	const result = await running;
	expect(result.details).toEqual({
		cancelled: false,
		answers: [{ question: "Which?", header: "Pick", picked: ["B"], notes: [] }],
		by: { kind: "terminal", name: "new-cdef", machine: expect.any(String) },
	});
	expect(result.content).toEqual([
		{
			type: "text",
			text: 'The user answered:\n- Pick: "Which?" → "B"\nContinue with these answers in mind.',
		},
	]);
});

test("the dialog fits the row it is given, and what the reader typed under it stays", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { tool } = await mounted(ctx);
	term.text = "a draft of my own";
	const running = run(tool, PARAMS, ctx);
	await drawn(term);
	// A line wider than the row is cut with dots, and a question this short has nothing to cut.
	expect(seen(term)).not.toContain("...");
	for (const line of term.draw(SLOT, 80) ?? []) expect(visibleWidth(line)).toBeLessThanOrEqual(80);

	// One frame around the dialog: the slot's, with the dialog's title and keys on it.
	const top = (term.draw(SLOT, 80) ?? []).filter((line) => line.includes("\u256d"));
	expect(top).toHaveLength(1);
	expect(top[0]).toContain("Pick");

	term.press(ENTER);
	await running;
	expect(term.text).toBe("a draft of my own");
});

test("Escape reaches the dialog, which cancels with the answers it already has", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { tool } = await mounted(ctx);
	const first = PARAMS.questions[0]!;
	const running = run(tool, { questions: [first, { ...first, question: "Again?" }] }, ctx);
	await drawn(term);
	term.press(ENTER, ESC);
	const result = await running;
	expect(result.details).toMatchObject({ cancelled: true });
	expect((result.details as { answers: { picked: string[] }[] }).answers[0]?.picked).toEqual(["A"]);
});

test("another package asks through the same dialog", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const { ctx, term } = terminalContext();
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
	await drawn(term);
	term.press(ENTER);
	// The dialog in this terminal answered it, under the session's name.
	const by = { kind: "terminal", name: "new-cdef", machine: expect.any(String) };
	expect(await answered).toEqual({ id: "ask-1", by, result: PICKED_A });
});

test("a dialog a phone answered first closes, and says where it was answered", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const notes: string[] = [];
	const ctx = context(notes, true);
	const term = fakeTerminal(ctx);
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);

	const closed = new Promise((resolve) => bus.on(CANCEL, resolve));
	const asker = askQuestions(bus, PARAMS.questions, { id: "ask-1" });
	await drawn(term);
	const phone = { kind: "client", name: "phone", machine: "m" } as const;
	bus.emit(ANSWER, { id: "ask-1", by: phone, result: PICKED_A });
	await asker;
	await closed;
	expect(notes).toEqual(["answered on phone"]);
	expect(term.draw(SLOT)).toBeUndefined();
});

test("a dialog the terminal answered itself says nothing about where", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const notes: string[] = [];
	const ctx = context(notes, true);
	const term = fakeTerminal(ctx);
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);

	const asker = askQuestions(bus, PARAMS.questions);
	await drawn(term);
	term.press(ENTER);
	await asker;
	expect(notes).toEqual([]);
});

test("a question the asker draws in its own terminal is not drawn twice", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const { ctx, term } = terminalContext();
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);

	bus.emit(ASK, { id: "ask-1", questions: PARAMS.questions, drawn: true });
	for (let wait = 0; wait < 20; wait++) await tick();
	expect(term.built).toBe(0);
});

test("the terminal answers under the handle the names gave the session", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	// Pi's session name holds the title, which is not what the room calls the session.
	const titled = { ...SESSION, getSessionName: () => "Streaming response screen" };
	const { ctx, term } = terminalContext({ sessionManager: titled });
	const scope = { events: bus, warn: () => {} } as unknown as EventScope;
	NAMES.provide(scope, () => ({ handle: "otter" }));
	createApp(fake.pi, { name: "test", settingsPath }).use(questions).build();
	await fake.fire("session_start", {}, ctx);

	const answered = new Promise<unknown>((resolve) => bus.on(ANSWER, resolve));
	bus.emit(ASK, { id: "ask-1", questions: PARAMS.questions });
	await drawn(term);
	term.press(ENTER);
	expect(await answered).toMatchObject({ by: { kind: "terminal", name: "otter" } });
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
	await fake.fire("session_start", {}, context());

	const answered = new Promise<{ result: { error?: string; cancelled: boolean } }>((resolve) => {
		bus.on(ANSWER, (data: unknown) => resolve(data as never));
	});
	bus.emit(ASK, { id: "ask-1", questions: [{ header: "Pick", question: "Which?" }] });
	const { result } = await answered;
	expect(result.cancelled).toBe(true);
	expect(result.error).toContain("did not decode");
});

test("a dialog that cannot be drawn still answers the asker", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const ctx = context([], true, {
		ui: {
			setWidget: () => {
				throw new Error("boom");
			},
			getEditorText: () => "",
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
	const ctx = context([], true, {
		mode: "rpc",
		ui: { select: async () => "1. A: a", input: async () => undefined },
	});
	const { tool } = await mounted(ctx);
	const result = await run(tool, PARAMS, ctx);
	expect(result.details).toMatchObject({ cancelled: false, answers: [{ picked: ["A"] }] });
});

test("two asks at once draw one after the other, since pi strands a replaced dialog", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const { ctx, term } = terminalContext();
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
	await drawn(term);
	await tick();
	expect(term.built).toBe(1);

	term.press(ESC);
	await drawn(term, 2);
	expect(answered).toEqual(["ask-1"]);

	term.press(ESC);
	await tick();
	expect(answered).toEqual(["ask-1", "ask-2"]);
});

test("the model's questions open once you stop typing in the editor", async () => {
	writeFileSync(
		settingsPath,
		JSON.stringify({ questions: { bell: false, typing: { pause: 40 } } }),
	);
	const statuses: (string | undefined)[] = [];
	const { ctx, term } = terminalContext({
		ui: { setStatus: (_key: string, text: string | undefined) => statuses.push(text) },
	});
	const { tool } = await mounted(ctx);

	term.press("a");
	const typedAt = Date.now();
	const running = run(tool, PARAMS, ctx);
	await drawn(term);
	const openedAt = Date.now();
	term.press(ESC);
	await running;

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

/** The spinner the tab of a question still being written turns. */
const WRITING = /[\u2800-\u28ff]/;

const closed = (term: Term) => term.draw(SLOT) === undefined;

test("the dialog opens while the model writes, and the tool waits on the same answer", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { fake, tool } = await mounted(ctx);
	const first = PARAMS.questions[0]!;
	const params = { questions: [first, { ...first, question: "Again?" }] };

	await fake.fire("message_update", streaming("call", { questions: [{ question: "Wh" }] }), ctx);
	await drawn(term);
	expect(seen(term)).toContain("Wh");

	await fake.fire(
		"message_update",
		streaming("call", { questions: [first, { question: "And" }] }),
		ctx,
	);
	expect(seen(term)).toMatch(WRITING);
	await fake.fire("message_update", streaming("call", params, true), ctx);
	expect(seen(term)).not.toMatch(WRITING);

	const running = tool.execute("call", params, undefined, undefined, ctx as ExtensionToolContext);
	term.press(ENTER, ENTER, ENTER);
	const result = await running;
	expect(result.details).toEqual({
		cancelled: false,
		answers: [
			{ question: "Which?", header: "Pick", picked: ["A"], notes: [] },
			{ question: "Again?", header: "Pick", picked: ["A"], notes: [] },
		],
		by: { kind: "terminal", name: "new-cdef", machine: expect.any(String) },
	});
	expect(term.built).toBe(1);
});

test("a call that never runs closes the dialog it opened", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { fake } = await mounted(ctx);

	await fake.fire(
		"message_update",
		streaming("call", { questions: [{ question: "Which?" }] }),
		ctx,
	);
	await drawn(term);
	await fake.fire("tool_execution_end", { type: "tool_execution_end", toolCallId: "call" }, ctx);
	expect(closed(term)).toBe(true);
	await fake.fire(
		"message_update",
		streaming("call", { questions: [{ question: "Which?" }] }, true),
		ctx,
	);
	await tick();
	expect(term.built).toBe(1);
});

test("a stream that breaks mid-call never takes back a question or leaves the dialog open", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { fake } = await mounted(ctx);
	const first = PARAMS.questions[0]!;
	const fire = (args: unknown, done = false) =>
		fake.fire("message_update", streaming("call", args, done), ctx);

	await fire({ questions: [first, { question: "Next?" }] });
	await drawn(term);
	const before = seen(term);
	// A delta that no longer parses comes back as `{}`, or with fewer questions: both are skipped.
	await fire({});
	await fire({ questions: [first] });
	await fire("not an object");
	await fire({ questions: [first, { question: "Next?", options: [{ label: 7 }, null] }] });
	expect(seen(term)).toContain("Which?");
	expect(seen(term)).toMatch(WRITING);
	expect(closed(term)).toBe(false);
	expect(before).toMatch(WRITING);

	// The reply ends without finishing the call, as on an abort, an error or the token limit.
	await fake.fire("turn_end", { type: "turn_end", toolResults: [] }, ctx);
	expect(closed(term)).toBe(true);
});

test("arguments that never parse close the dialog when the call ends", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { fake } = await mounted(ctx);

	await fake.fire(
		"message_update",
		streaming("call", { questions: [{ question: "Which?" }] }),
		ctx,
	);
	await drawn(term);
	// Pi hands malformed JSON over as `{}` once the call is finished.
	await fake.fire("message_update", streaming("call", {}, true), ctx);
	expect(closed(term)).toBe(true);
});

/** What this session's log holds, by type. */
function logged(): LoggedEvent[] {
	return readFrom(logPath(targetOf(SESSION)), 0).events;
}

test("an ask_questions call goes through the bus, so its question and its answer are logged", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { tool } = await mounted(ctx);
	const running = tool.execute("call-1", PARAMS, undefined, undefined, ctx as ExtensionToolContext);
	await drawn(term);
	term.press(ENTER);
	await running;

	const events = logged();
	expect(events.map((event) => event.type)).toEqual(["ask.opened", "ask.closed"]);
	expect(events[0]?.data).toEqual({
		id: "call-1",
		source: "ask-questions",
		questions: PARAMS.questions,
	});
	expect(events[1]?.data).toMatchObject({ id: "call-1", by: { kind: "terminal" } });
});

test("the dialog that opened early is the one the call's question uses, logged once", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const { ctx, term } = terminalContext();
	const { fake, tool } = await mounted(ctx);
	await fake.fire("message_update", streaming("call", PARAMS), ctx);
	await fake.fire("message_update", streaming("call", PARAMS, true), ctx);
	await drawn(term);
	const running = tool.execute("call", PARAMS, undefined, undefined, ctx as ExtensionToolContext);
	term.press(ENTER);

	expect((await running).details).toEqual({
		...PICKED_A,
		by: { kind: "terminal", name: "new-cdef", machine: expect.any(String) },
	});
	expect(term.built).toBe(1);
	expect(logged().filter((event) => event.type === "ask.opened")).toHaveLength(1);
});

test("when someone else answers first, the dialog here closes and the call takes their answer", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const bus = createEventBus();
	const { ctx, term } = terminalContext();
	const { tool } = await mounted(ctx, [TOOL_NAME], bus);
	const answers: unknown[] = [];
	bus.on(ANSWER, (data: unknown) => void answers.push(data));

	const running = tool.execute("call", PARAMS, undefined, undefined, ctx as ExtensionToolContext);
	await drawn(term);
	const phone = { kind: "client", name: "phone", machine: "laptop" };
	bus.emit(ANSWER, { id: "call", by: phone, result: PICKED_A });

	expect((await running).details).toEqual({ ...PICKED_A, by: phone });
	await tick();
	// The dialog closed, and this terminal never answered over the phone.
	expect(closed(term)).toBe(true);
	expect(answers).toHaveLength(1);
	expect(logged().at(-1)?.data).toMatchObject({ by: phone });
});

test("a cancel closes a drawn dialog, and drops a queued one before it draws", async () => {
	const bus = createEventBus();
	const fake = fakePi(bus);
	const { ctx, term } = terminalContext();
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
	await drawn(term);
	bus.emit(CANCEL, { id: "ask-2", reason: "answered" });
	term.press(ENTER);
	await tick();
	await tick();
	expect(term.built).toBe(1);
	expect(answered).toEqual(["ask-1"]);
});

test("a cancel closes the dialog on screen as cancelled, with no answer from here", async () => {
	const bus = createEventBus();
	const { ctx, term } = terminalContext();
	await mounted(ctx, [TOOL_NAME], bus);
	const answered: unknown[] = [];
	bus.on(ANSWER, (data: unknown) => void answered.push(data));
	bus.emit(ASK, { id: "ask-1", questions: PARAMS.questions });
	await drawn(term);

	bus.emit(CANCEL, { id: "ask-1", reason: "aborted" });
	await tick();
	expect(closed(term)).toBe(true);
	expect(answered).toEqual([]);
});

test("a request that does not decode closes the dialog the stream opened, with the reason", async () => {
	writeFileSync(settingsPath, JSON.stringify({ questions: { bell: false } }));
	const bus = createEventBus();
	const { ctx, term } = terminalContext();
	const { fake } = await mounted(ctx, [TOOL_NAME], bus);
	await fake.fire("message_update", streaming("call", PARAMS), ctx);
	await drawn(term);

	const answered = new Promise<unknown>((resolve) => bus.on(ANSWER, resolve));
	bus.emit(ASK, { id: "call", questions: [{ header: "Pick" }] });
	expect(await answered).toMatchObject({
		id: "call",
		result: { cancelled: true, error: expect.stringContaining("the request did not decode") },
	});
	expect(closed(term)).toBe(true);
});

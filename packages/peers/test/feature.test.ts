import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	BOARD,
	createApp,
	emptyBoard,
	eventsDir,
	FolderFeed,
	HOST,
	provideViews,
	type SourceAddress,
} from "@adeildo/pi-kit";
import { fakeContext, fakePi } from "@adeildo/pi-kit/testing";
import type { Component, TUI } from "@earendil-works/pi-tui";

import { PEER_HELD } from "../src/inbox.ts";
import { committed, peers } from "../src/index.ts";
import { PEER_WENT_IN } from "../src/ui/held.ts";

let dir: string;

type CustomFactory = (tui: TUI, theme: unknown, keys: unknown, done: () => void) => Component;
const TUI_STUB = {
	terminal: { rows: 30, columns: 100 },
	requestRender: () => {},
} as unknown as TUI;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "peers-feature-"));
	process.env.PI_HARNESS_EVENTS = join(dir, "events");
});

afterEach(() => {
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(dir, { recursive: true, force: true });
});

async function mounted(
	id: string,
	cwd = "/repo",
	entries: unknown[] = [],
	extra?: Parameters<ReturnType<typeof createApp>["use"]>[0],
) {
	writeFileSync(join(dir, "settings.json"), "{}");
	const fake = fakePi();
	let active = ["read", "bash"];
	Object.assign(fake.pi, {
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => {
			active = names;
		},
	});
	const app = createApp(fake.pi, { name: "test", settingsPath: join(dir, "settings.json") });
	if (extra !== undefined) app.use(extra);
	app.use(peers).build();
	const notes: string[] = [];
	let editor = "";
	const ctx = fakeContext([], true, {
		cwd,
		sessionManager: {
			getBranch: () => [],
			getEntries: () => entries,
			getCwd: () => cwd,
			getSessionId: () => id,
			getSessionFile: () => `/sessions/${id}.jsonl`,
		},
		ui: {
			notify: (message: string) => notes.push(message),
			setEditorText: (text: string) => (editor = text),
			addAutocompleteProvider: () => {},
			setWidget: () => {},
			theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
		},
		isIdle: () => true,
	});
	await fake.fire("session_start", {}, ctx);
	return { fake, ctx, notes, editor: () => editor, active: () => active };
}

test("no tool writes the folder's logs, so nothing can post words as yours", async () => {
	const { fake, ctx } = await mounted("a");
	const logs = eventsDir("/repo");
	const [write] = await fake.fire(
		"tool_call",
		{ toolName: "write", input: { path: join(logs, "x.jsonl") } },
		ctx,
	);
	expect(write).toMatchObject({ block: true });
	const [bash] = await fake.fire(
		"tool_call",
		{ toolName: "bash", input: { command: "echo '{}' >> ~/.pi/agent/harness/events/x.jsonl" } },
		ctx,
	);
	expect(bash).toMatchObject({ block: true });
	const [edit] = await fake.fire(
		"tool_call",
		{ toolName: "edit", input: { path: "src/auth.ts" } },
		ctx,
	);
	expect(edit).toBeUndefined();

	// Reading the logs stays allowed: that is how an agent looks at the folder.
	const [listed] = await fake.fire(
		"tool_call",
		{ toolName: "bash", input: { command: `ls ${logs}` } },
		ctx,
	);
	expect(listed).toBeUndefined();
	const [read] = await fake.fire(
		"tool_call",
		{ toolName: "read", input: { path: join(logs, "x.jsonl") } },
		ctx,
	);
	expect(read).toBeUndefined();
});

test("what the agent edits, runs and commits goes on the board", async () => {
	const { fake, ctx } = await mounted("a");
	await fake.fire(
		"tool_execution_start",
		{ toolCallId: "1", toolName: "edit", args: { path: "/repo/src/auth.ts" } },
		ctx,
	);
	await fake.fire(
		"tool_execution_end",
		{ toolCallId: "1", toolName: "edit", isError: false, result: {} },
		ctx,
	);
	await fake.fire(
		"tool_execution_start",
		{ toolCallId: "2", toolName: "bash", args: { command: "git commit -m x" } },
		ctx,
	);
	await fake.fire(
		"tool_execution_end",
		{
			toolCallId: "2",
			toolName: "bash",
			isError: false,
			result: {
				content: [{ type: "text", text: "[main 3f2a91c] Fix the callback\n 1 file changed" }],
			},
		},
		ctx,
	);
	const activity = new FolderFeed(eventsDir("/repo"))
		.read()
		.filter((event) => event.type === "activity")
		.map((event) => event.data);
	expect(activity).toEqual([
		{ kind: "edited", path: "src/auth.ts" },
		{ kind: "ran", command: "git commit -m x", ok: true },
		{ kind: "committed", sha: "3f2a91c", subject: "Fix the callback" },
	]);
});

function posted() {
	return new FolderFeed(eventsDir("/repo"))
		.read()
		.filter((event) => event.type === "message.posted")
		.map((event) => Object.assign({ session: event.session }, event.data));
}

test("a message that mentions another agent goes to it instead of yours", async () => {
	const a = await mounted("a");
	await mounted("b");
	const [result] = await a.fake.fire(
		"input",
		{ text: "@new-b run the tests", source: "interactive" },
		a.ctx,
	);
	expect(result).toEqual({ action: "handled" });
	expect(posted()).toMatchObject([
		{ session: "a", from: "you", to: ["b"], text: "@new-b run the tests" },
	]);
	expect(a.notes).toEqual(["Sent to @new-b."]);
});

test("@everyone tells every agent, yours too, @anyone asks for one, and a file stays yours", async () => {
	const a = await mounted("a");
	const b = await mounted("b");
	const fire = (text: string) => a.fake.fire("input", { text, source: "interactive" }, a.ctx);
	expect(await fire("read @src/new-b.ts and @nobody")).toEqual([{ action: "continue" }]);
	expect(await fire("@everyone deploy at six, keep off main")).toEqual([{ action: "handled" }]);
	expect(await fire("@anyone who takes the deploy?")).toEqual([{ action: "handled" }]);
	expect(posted()).toMatchObject([
		{ to: "all", text: "@everyone deploy at six, keep off main" },
		{ to: "any", text: "@anyone who takes the deploy?" },
	]);
	expect(a.fake.userMessages).toEqual(["@everyone deploy at six, keep off main"]);
	// Typing in b reads the folder, as its watcher would.
	await b.fake.fire("input", { text: "go on", source: "interactive" }, b.ctx);
	expect(b.fake.userMessages).toEqual(["@everyone deploy at six, keep off main"]);
});

test("@everyone alone in the folder puts your words back in the editor", async () => {
	const { fake, ctx, notes, editor } = await mounted("a");
	await fake.fire("input", { text: "@everyone ship it", source: "interactive" }, ctx);
	expect(notes).toEqual(["No other agent is open in this folder or in your rooms."]);
	expect(editor()).toBe("@everyone ship it");
	expect(posted()).toEqual([]);
});

test("@everyone reaches an agent of another folder in a shared room, once each; @anyone asks the folder first", async () => {
	const a = await mounted("a");
	const b = await mounted("b", "/other");
	const tool = a.fake.tools.find((candidate) => candidate.name === "peers");
	await tool?.execute(
		"1",
		{ action: "link", folder: "/other" },
		undefined,
		undefined,
		undefined as never,
	);
	// b joins on its next look.
	await b.fake.fire("input", { text: "go on", source: "interactive" }, b.ctx);
	const fire = (text: string) => a.fake.fire("input", { text, source: "interactive" }, a.ctx);
	expect(await fire("@everyone ship it")).toEqual([{ action: "handled" }]);
	expect(a.notes.at(-1)).toBe("Sent to @everyone: every agent here gets it.");
	await b.fake.fire("input", { text: "go on", source: "interactive" }, b.ctx);
	expect(b.fake.userMessages).toEqual(["@everyone ship it"]);
	expect(a.fake.userMessages).toEqual(["@everyone ship it"]);

	// With an agent in this folder too, @anyone stays in the folder's room: one request, one taker.
	await mounted("c");
	expect(await fire("@anyone take the deploy")).toEqual([{ action: "handled" }]);
	expect(posted()).toMatchObject([{ to: "any", text: "@anyone take the deploy" }]);
	expect(await fire("@everyone deploy at six")).toEqual([{ action: "handled" }]);
	await b.fake.fire("input", { text: "go on", source: "interactive" }, b.ctx);
	expect(b.fake.userMessages).toEqual(["@everyone ship it", "@everyone deploy at six"]);
	expect(a.fake.userMessages).toEqual(["@everyone ship it", "@everyone deploy at six"]);
});

test("a run turns the tool back on when something else left it off", async () => {
	const { fake, ctx, active } = await mounted("a");
	await fake.fire("before_agent_start", { type: "before_agent_start", prompt: "" }, ctx);
	expect(active()).toEqual(["read", "bash", "peers"]);
	await fake.fire("before_agent_start", { type: "before_agent_start", prompt: "" }, ctx);
	expect(active()).toEqual(["read", "bash", "peers"]);
});

test("the board action answers with the whole title, not what the panel would cut", async () => {
	// The panel cuts at the width it is drawn in; the model reads the board itself, so a long title
	// has to arrive whole — the two renderers are not interchangeable.
	const long = "a card whose title is long enough that a hundred columns would cut it somewhere";
	const board = {
		...emptyBoard(),
		cards: [{ id: "c1", title: long, column: "todo" as const, at: 1 }],
	};
	const provider = {
		id: "board-for-the-test",
		description: "offers the board",
		setup: (scope: Parameters<typeof BOARD.provide>[0]) => BOARD.provide(scope, () => board),
	};
	const { fake } = await mounted("a", "/repo", [], provider as never);
	const tool = fake.tools.find((candidate) => candidate.name === "peers");
	const answer = await tool?.execute(
		"1",
		{ action: "board" },
		undefined,
		undefined,
		undefined as never,
	);
	const first = answer?.content[0];
	expect(first?.type === "text" ? first.text : "").toContain(long);
});

test("the tool reads the board and refuses names nobody has", async () => {
	const { fake } = await mounted("a");
	const tool = fake.tools.find((candidate) => candidate.name === "peers");
	const board = await tool?.execute(
		"1",
		{ action: "board" },
		undefined,
		undefined,
		undefined as never,
	);
	expect(board?.content[0]).toMatchObject({ text: "No other agent is working in this folder." });
	const sent = await tool?.execute(
		"2",
		{ action: "send", to: "ghost", text: "hi" },
		undefined,
		undefined,
		undefined as never,
	);
	expect(sent?.content[0]).toMatchObject({
		text: "No other agent here is called ghost. Read the board for the names.",
	});
});

test("Alt+G opens the rooms", async () => {
	const { fake } = await mounted("a");
	expect(fake.shortcuts).toContain("alt+g");
});

async function until(done: () => boolean, tries = 100): Promise<void> {
	if (done() || tries === 0) return;
	await Bun.sleep(10);
	return until(done, tries - 1);
}

describe("enter on an agent in Alt+G", () => {
	/** Opens a's panel and moves to b's line, the only line whose hints mention writing to an agent. */
	async function onB(provide?: (address: SourceAddress) => boolean) {
		const a = await mounted("a");
		await mounted("b");
		if (provide !== undefined) provideViews(a.fake.pi.events, provide);
		let panel: Component | undefined;
		const ctx = Object.assign(Object.create(a.ctx), {
			mode: "tui",
			ui: {
				...a.ctx.ui,
				custom: (factory: CustomFactory) =>
					new Promise<void>((done) => {
						panel = factory(TUI_STUB, a.ctx.ui.theme, {}, done);
					}),
			},
		});
		void a.fake.shortcutHandlers.get("alt+g")?.(ctx);
		const press = (...keys: string[]) => {
			for (const key of keys) panel?.handleInput?.(key);
			return panel?.render(100).join("\n") ?? "";
		};
		// b's start reaches a's folder log through the watcher, a moment later.
		await until(() => press().includes("new-b"));
		press("\t");
		for (let i = 0; i < 6 && !/@ write to|enter write to/.test(press()); i++) press("\u001b[B");
		return { press, close: () => press("\u001b") };
	}

	test("shows its session, read from the file its presence entry names", async () => {
		const opened: SourceAddress[] = [];
		const { press, close } = await onB((address) => opened.push(address) > 0);
		expect(press()).toContain("enter view");
		press("\r");
		expect(opened).toEqual([{ session: "b", machine: HOST, file: "/sessions/b.jsonl" }]);
		close();
	});

	test("writes to the agent when the one that can show sessions does not open it", async () => {
		const { press, close } = await onB(() => false);
		expect(press("\r")).toContain("@new-b");
		close();
	});

	test("writes to the agent when nothing can show a session", async () => {
		const { press, close } = await onB();
		expect(press()).toContain("enter write to");
		expect(press("\r")).toContain("@new-b");
		close();
	});
});

test("a subagent stays out of the room, so its prompt and a woke note cannot collide", async () => {
	process.env.PI_SUBAGENT_CHILD = "1";
	try {
		const { fake } = await mounted("child");
		expect(fake.tools.map((tool) => tool.name)).not.toContain("peers");
		expect(fake.shortcuts).not.toContain("alt+g");
		expect(new FolderFeed(eventsDir("/repo")).read()).toHaveLength(0);
		expect(fake.messages).toHaveLength(0);
	} finally {
		delete process.env.PI_SUBAGENT_CHILD;
	}
});

test("a commit line is read from git's output, with or without a root-commit note", () => {
	expect(committed("[main (root-commit) abc1234] First")).toEqual({
		sha: "abc1234",
		subject: "First",
	});
	expect(committed("nothing to commit")).toBeUndefined();
});

/** What the held entry says under its frames, drawn by the renderer the feature registered. */
function heldLine(fake: ReturnType<typeof fakePi>, data: unknown): string {
	const renderer = fake.renderers.get(PEER_HELD);
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const block = renderer?.({ data } as never, { expanded: false }, theme as never);
	return (block?.render(200) ?? []).join("\n");
}

test("a held line that went in with a run you did not start still says so when the session opens again", async () => {
	const a = await mounted("a");
	const b = await mounted("b");
	await a.fake.fire("input", { text: "go", source: "interactive" }, a.ctx);
	const tool = a.fake.tools.find((candidate) => candidate.name === "peers");
	await tool?.execute(
		"1",
		{ action: "send", to: "new-b", text: "look at this" },
		undefined,
		undefined,
		a.ctx as never,
	);
	// b has no prompt yet, so it holds the message; then a run that is not yours starts.
	await b.fake.fire("agent_settled", {}, b.ctx);
	const held = b.fake.entries.find((entry) => entry.customType === PEER_HELD);
	expect(heldLine(b.fake, held?.data)).toContain("It waits for your first prompt");
	await b.fake.fire("agent_start", {}, b.ctx);
	expect(heldLine(b.fake, held?.data)).toContain("It went in with the next run");
	const went = b.fake.entries.filter((entry) => entry.customType === PEER_WENT_IN);
	expect(went).toHaveLength(1);

	// The same session opened again reads it back from its entries.
	const again = await mounted("b", "/repo", [
		{ type: "custom", customType: PEER_WENT_IN, data: went[0]?.data },
	]);
	expect(heldLine(again.fake, held?.data)).toContain("It went in with the next run");
	// Another session in the same process starts clean.
	await again.fake.fire("session_start", {}, {
		...again.ctx,
		sessionManager: { ...again.ctx.sessionManager, getEntries: () => [] },
	} as never);
	expect(heldLine(again.fake, held?.data)).toContain("It waits for your first prompt");
});

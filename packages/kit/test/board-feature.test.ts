import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../src/app/builder.ts";
import { board } from "../src/board/feature.ts";
import { BOARD } from "../src/contracts/board.ts";
import { fakeContext, fakePi } from "../src/testing.ts";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "board-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const op = (data: unknown): unknown => ({ type: "custom", customType: "pi-board:op", data });

test("the board a session starts with is the fold of its branch, offered to readers", async () => {
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(root, "settings.json") })
		.use(board)
		.build();
	const branch = [
		op({ version: 1, op: { op: "add", title: "Uma", at: 1 } }),
		op({ version: 1, op: { op: "move", id: "c1", column: "review", reviewer: "quokka", at: 2 } }),
		op({ version: 1, op: { op: "decide", text: "a palavra é board", at: 3 } }),
	];
	await fake.fire(
		"session_start",
		{},
		fakeContext([], true, {
			sessionManager: { getCwd: () => "/repo", getSessionId: () => "s1", getBranch: () => branch },
		}),
	);
	const value = BOARD.current({ events: fake.pi.events, warn: () => {} });
	expect(value?.cards.map((card) => [card.title, card.column, card.reviewer])).toEqual([
		["Uma", "review", "quokka"],
	]);
	expect(value?.decisions.map((decision) => decision.text)).toEqual(["a palavra é board"]);
});

test("the board tool writes one operation, and the readers see the card", async () => {
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(root, "settings.json") })
		.use(board)
		.build();
	const ctx = fakeContext([], true, {
		sessionManager: { getCwd: () => "/repo", getSessionId: () => "s1", getBranch: () => [] },
	});
	await fake.fire("session_start", {}, ctx);
	const tool = fake.tools.find((one) => one.name === "board");
	expect(tool).toBeDefined();
	const result = await tool?.execute(
		"call-1",
		{ op: "add", title: "Uma" },
		undefined,
		undefined,
		ctx as never,
	);
	expect(JSON.stringify(result)).toContain("Uma");
	const value = BOARD.current({ events: fake.pi.events, warn: () => {} });
	expect(value?.cards.map((card) => card.title)).toEqual(["Uma"]);
});

test("unblock clears what the card waited on", async () => {
	const fake = fakePi();
	createApp(fake.pi, { name: "test", settingsPath: join(root, "settings.json") })
		.use(board)
		.build();
	const ctx = fakeContext([], true, {
		sessionManager: { getCwd: () => "/repo", getSessionId: () => "s1", getBranch: () => [] },
	});
	await fake.fire("session_start", {}, ctx);
	const tool = fake.tools.find((one) => one.name === "board");
	const call = (params: Record<string, unknown>) =>
		tool?.execute("call", params, undefined, undefined, ctx as never);
	await call({
		op: "add",
		title: "Escolher os consertos",
		blocked: { on: "operator", why: "qual?" },
	});
	await call({ op: "edit", id: "c1", unblock: true });
	const value = BOARD.current({ events: fake.pi.events, warn: () => {} });
	expect(value?.cards[0]?.blocked).toBeUndefined();
});

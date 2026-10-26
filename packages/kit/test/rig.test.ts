import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";

import { createApp } from "../src/app/builder.ts";
import { defineFeature } from "../src/app/feature.ts";
import { board } from "../src/board/feature.ts";
import { createRig, type Rig } from "../src/rig.ts";

let rig: Rig | undefined;

afterEach(() => {
	rig?.dispose();
	rig = undefined;
});

function scriptedBoard(): (context: unknown) => AssistantMessage {
	let calls = 0;
	return () => {
		calls += 1;
		if (calls > 1) return fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" });
		return fauxAssistantMessage(
			[fauxText("Two files."), fauxToolCall("board", { op: "add", title: "Build the rig" })],
			{
				stopReason: "toolUse",
			},
		);
	};
}

describe("a real pi session with a scripted model", () => {
	test("a turn leaves its entries in the session file and its board operation in the log", async () => {
		rig = await createRig({
			answer: scriptedBoard(),
			extensions: [
				(pi) => {
					createApp(pi, { name: "rig" }).use(board).build();
				},
			],
		});

		await rig.prompt("What is in this folder?");

		const file = rig.session.sessionFile;
		expect(file).toBeDefined();
		const entries = readFileSync(file ?? "", "utf8")
			.trim()
			.split("\n")
			.map(
				(line) =>
					JSON.parse(line) as { type: string; message?: { role?: string }; customType?: string },
			);
		expect(entries.some((entry) => entry.message?.role === "user")).toBe(true);
		expect(entries.some((entry) => entry.message?.role === "assistant")).toBe(true);
		expect(entries.some((entry) => entry.customType === "pi-board:op")).toBe(true);
	});

	test("a turn that fails to answer ends the rig instead of hanging", async () => {
		rig = await createRig({ replies: [] });
		await rig.prompt("Anything?");
		expect(rig.session.isIdle).toBe(true);
	});
});

describe("what the terminal is told", () => {
	test("a feature's notify reaches the test, with the level it asked for", async () => {
		// A feature of three lines: the point is the screen the rig hands it, not the feature.
		const say = defineFeature({
			id: "say",
			description: "says what a test reads back",
			setup(scope) {
				scope.onSessionStart((ctx) => {
					ctx.ui.notify("pi-remote: http://127.0.0.1:7878/#token=abc works once", "info");
					ctx.ui.notify("no daemon answered", "warning");
				});
			},
		});
		rig = await createRig({
			extensions: [
				(pi) => {
					createApp(pi, { name: "say" }).use(say).build();
				},
			],
		});
		await rig.prompt("anything");
		expect(rig.notified).toEqual([
			{ message: "pi-remote: http://127.0.0.1:7878/#token=abc works once", level: "info" },
			{ message: "no daemon answered", level: "warning" },
		]);
	});

	test("what an extension throws where pi swallows it is kept, not hidden", async () => {
		// A handler that fails reaches `emitError` in pi and never reaches the test: that is how a
		// feature goes silent in a run and breaks in a terminal.
		const rig = await createRig({
			extensions: [
				(pi) => {
					pi.on("session_start", () => {
						throw new Error("the handler broke");
					});
				},
			],
		});
		try {
			await Bun.sleep(50);
			expect(rig.errors.map((one) => one.error)).toContain("the handler broke");
		} finally {
			rig.dispose();
		}
	});
});

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";

import { tasks } from "../../tasks/src/index.ts";
import { createApp } from "../src/app/builder.ts";
import { defineFeature } from "../src/app/feature.ts";
import { createRig, type Rig, SCRIPTED } from "../src/rig.ts";

let rig: Rig | undefined;

afterEach(() => {
	rig?.dispose();
	rig = undefined;
});

/** Whether the request is the tasks feature keeping the list, which it asks with a prompt of its own. */
function aboutTasks(context: { messages: { role: string; content: unknown }[] }): boolean {
	const asked = context.messages.at(-1)?.content;
	const text =
		typeof asked === "string"
			? asked
			: Array.isArray(asked)
				? asked
						.filter((part) => (part as { type?: string }).type === "text")
						.map((part) => (part as { text?: string }).text ?? "")
						.join(" ")
				: "";
	return text.includes("<tasks>");
}

/** A change the tasks feature's own model proposes, in the shape its tool takes. */
type WireOp =
	| { op: "title"; text: string; handle: string }
	| { op: "new_task"; text: string; proof: string };

/**
 * What the model answers. The tasks feature asks the same model, so the script routes on the
 * question instead of on the order the calls arrive in.
 */
function scripted(
	reply: () => AssistantMessage,
	ops: WireOp[] = [],
): (context: { messages: { role: string; content: unknown }[] }) => AssistantMessage {
	return (context) =>
		aboutTasks(context)
			? fauxAssistantMessage([fauxToolCall("update_tasks", { language: "English", ops })], {
					stopReason: "toolUse",
				})
			: reply();
}

describe("a real pi session with a scripted model", () => {
	test("a turn leaves its entries in the session file and its facts in the log", async () => {
		rig = await createRig({
			answer: (context) =>
				scripted(
					() => fauxAssistantMessage([fauxText("Two files.")], { stopReason: "stop" }),
					[
						{ op: "title", text: "Rig test", handle: "rig" },
						{ op: "new_task", text: "Build the rig", proof: "in this folder" },
					],
				)(context),
			extensions: [
				(pi) => {
					createApp(pi, { name: "rig" }).use(tasks).build();
				},
			],
			// The tasks feature keeps the list with a model of its own, and the catalogue holds every
			// provider. Point it at the scripted one, or it reaches for a real model.
			settings: { tasks: { model: SCRIPTED } },
		});

		await rig.prompt("What is in this folder?");

		const file = rig.session.sessionFile;
		expect(file).toBeDefined();
		const entries = readFileSync(file ?? "", "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { type: string; message?: { role?: string } });
		expect(entries.some((entry) => entry.message?.role === "user")).toBe(true);
		expect(entries.some((entry) => entry.message?.role === "assistant")).toBe(true);

		// The tasks feature asks its own model after the run settles, so the log grows after the turn.
		const lines = await rig.until(
			(line) =>
				line.type === "tasks.changed" && (line.data.state as { tasks: unknown[] }).tasks.length > 0,
		);
		const types = lines.map((line) => line.type);
		expect(types).toContain("tasks.changed");
		const kept = lines.at(-1)?.data.state as { tasks: { text: string }[] };
		expect(kept.tasks.map((task) => task.text)).toEqual(["Build the rig"]);
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

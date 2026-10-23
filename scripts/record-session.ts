#!/usr/bin/env bun
// Records one scripted run of a real pi: its session file and its harness log, into a folder. The
// recording is the fixture the protocol's reducers rebuild, so it carries pi's real order of events
// and nothing private: the model is scripted, the folder is temporary and the clock starts at zero.
//
//   bun scripts/record-session.ts [folder]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@earendil-works/pi-ai";

import { createApp } from "../packages/kit/src/app/builder.ts";
import { eventsDir, logPath } from "../packages/kit/src/index.ts";
import { createRig } from "../packages/kit/src/rig.ts";
import { tasks } from "../packages/tasks/src/index.ts";

const out =
	process.argv[2] ??
	join(import.meta.dir, "..", "packages", "remote-protocol", "test", "fixtures", "recording");

/** Whether this request is the tasks feature keeping the list, which it asks with its own prompt. */
function aboutTasks(messages: { content: unknown }[]): boolean {
	const asked = messages.at(-1)?.content;
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

let runs = 0;

/** What the scripted model answers: the tasks list, the run itself, and pi's summaries. */
function answer(context: { messages: { role: string; content: unknown }[] }): AssistantMessage {
	if (aboutTasks(context.messages)) {
		return fauxAssistantMessage(
			[
				fauxToolCall("update_tasks", {
					language: "English",
					ops: runs === 0 ? [{ op: "title", text: "Read the rig log", handle: "rig" }] : [],
				}),
			],
			{ stopReason: "toolUse" },
		);
	}
	runs++;
	if (runs === 1) {
		return fauxAssistantMessage(
			[
				fauxThinking("The log is in the events folder, one JSON line per fact."),
				fauxText("I will list the folder."),
				fauxToolCall("bash", { command: "ls" }),
			],
			{ stopReason: "toolUse" },
		);
	}
	return fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" });
}

const rig = await createRig({
	answer,
	extensions: [
		(pi) => {
			createApp(pi, { name: "pi-harness" }).use(tasks).build();
		},
	],
	// The tasks feature asks a model of its own, and the catalogue holds every provider. Without
	// this it would reach for a real one.
	settings: { tasks: { model: "rig/scripted" } },
});

try {
	// A turn with thinking, a tool call, and the tasks feature reading it.
	await rig.prompt("List what is in this folder.");
	const first = rig.session.sessionManager.getBranch()[0];
	// A second turn, which the tasks feature reads too, and a move in the tree: the leaf a reader
	// starts from stops being the newest entry. An aborted turn and a compaction need timing the
	// scripted model does not control, so they are written by hand where the reducers test them.
	await rig.prompt("Now read the log.");
	if (first !== undefined) rig.session.sessionManager.branch(first.id);
	await rig.until((line) => line.type === "tasks.changed");
} finally {
	mkdirSync(out, { recursive: true });
	// The recording goes into a public repository, so the folder the run used becomes a fixed one:
	// the paths in it say which folder is which, and never where they were.
	const settle = (from: string, to: string) =>
		writeFileSync(to, readFileSync(from, "utf8").replaceAll(rig.root, "/session"));
	const session = rig.session.sessionFile;
	if (session !== undefined) settle(session, join(out, "session.jsonl"));
	settle(
		logPath({ dir: eventsDir(rig.cwd, rig.events), session: rig.session.sessionId }),
		join(out, "harness.jsonl"),
	);
	writeFileSync(
		join(out, "README.md"),
		`# A recorded session\n\nWritten by \`bun scripts/record-session.ts\` A scripted model ran two\nturns: the first with thinking and a tool call, the second plain. The tasks feature kept the list\nafter each one, and the tree moved back to the first entry at the end. \`session.jsonl\` is pi's\nfile, \`harness.jsonl\` is the harness's log, and both are rebuilt by the reducers in\n\`test/transcript.test.ts\`.\n`,
	);
	console.log(`wrote ${out}`);
	rig.dispose();
}

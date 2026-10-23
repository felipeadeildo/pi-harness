#!/usr/bin/env bun
// Records one scripted run of a real pi: its session file and its harness log, into a folder. The
// recording is the fixture the protocol's reducers rebuild, so it carries pi's real order of events
// and nothing private: the model is scripted, the folder is temporary and the clock starts at zero.
//
//   bun scripts/record-session.ts [folder]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@earendil-works/pi-ai";

import { createApp } from "../packages/kit/src/app/builder.ts";
import { eventsDir, logPath } from "../packages/kit/src/index.ts";
import { createRig, SCRIPTED } from "../packages/kit/src/rig.ts";
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
	settings: { tasks: { model: SCRIPTED } },
});

try {
	// A turn with thinking, a tool call, and the tasks feature reading it.
	await rig.prompt("List what is in this folder.");
	const first = rig.session.sessionManager.getBranch()[0];
	// A second turn, which the tasks feature reads too.
	await rig.prompt("Now read the log.");
	// A move in the tree and a turn after it. `branch` only moves the leaf, so without the third
	// turn nothing in the file says the tree moved: the entries written next hang from the older one.
	if (first !== undefined) rig.session.sessionManager.branch(first.id);
	await rig.prompt("What did the first turn leave?");
	// An aborted turn and a compaction need timing the scripted model does not control. They are
	// written by hand in the protocol's reducer tests, from lines captured out of a real run.
	await rig.until((line) => line.type === "tasks.changed");
} finally {
	mkdirSync(out, { recursive: true });
	// The recording goes into a public repository. The folder the run used becomes a fixed one, and
	// every other trace of this machine goes: the home folder, the checkout the script ran from, and
	// the packages pi's prompt quotes.
	// Longest first: once the home folder is gone, the paths under it no longer match.
	const private_ = [rig.root, process.cwd(), dirname(process.cwd()), homedir()];
	const settle = (from: string) => {
		let text = readFileSync(from, "utf8");
		for (const part of private_) text = text.replaceAll(part, "/session");
		// Whatever path is left inside a package is a path on this machine, not a fact of the run.
		text = text.replaceAll(/(?:\/[^\s"\\]+)+\/node_modules\/[^\s"\\]*/g, "/node_modules/…");
		const left = [homedir(), "pi-rig-", "worktrees", "/node_modules/.bun"].filter((part) =>
			text.includes(part),
		);
		if (left.length > 0) throw new Error(`${from} still names ${left.join(", ")}`);
		return text;
	};
	const session = rig.session.sessionFile;
	if (session !== undefined) writeFileSync(join(out, "session.jsonl"), settle(session));
	writeFileSync(
		join(out, "harness.jsonl"),
		settle(logPath({ dir: eventsDir(rig.cwd, rig.events), session: rig.session.sessionId })),
	);
	writeFileSync(
		join(out, "README.md"),
		`# A recorded session\n\nWritten by \`bun scripts/record-session.ts\`. A scripted model ran three\nturns: the first with thinking and a tool call, the other two plain. The tasks feature kept the list\nafter each one. Between the second and the third, the tree moved back to the first entry, so the\nthird turn hangs from an older entry than the one before it. \`session.jsonl\` is pi's file and\n\`harness.jsonl\` is the harness's log. The reducers in \`test/transcript.test.ts\` rebuild both.\n\nAn aborted turn and a compaction are not here: the scripted model cannot be stopped mid answer,\nand pi refuses to compact a session this short. \`test/edges.test.ts\` covers them with lines\ncaptured from a real run.\n`,
	);
	console.log(`wrote ${out}`);
	rig.dispose();
}

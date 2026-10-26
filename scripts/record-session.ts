#!/usr/bin/env bun
// Records a scripted pi run (session file and harness log) as the fixture the reducers rebuild.
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
import { board, eventsDir, logPath, names } from "../packages/kit/src/index.ts";
import { createRig } from "../packages/kit/src/rig.ts";

const out =
	process.argv[2] ??
	join(import.meta.dir, "..", "packages", "remote-protocol", "test", "fixtures", "recording");

let runs = 0;

/** Longest first, since the home folder holds the rest. */
export function scrub(text: string, parts: readonly string[]): string {
	let scrubbed = text;
	for (const part of parts) scrubbed = scrubbed.replaceAll(part, "/session");
	// Whatever path is left inside a package is a path on this machine, not a fact of the run.
	scrubbed = scrubbed.replaceAll(/(?:\/[^\s"\\]+)+\/node_modules\/[^\s"\\]*/g, "/node_modules/…");
	const left = PRIVATE.filter((part) => scrubbed.includes(part));
	if (left.length > 0) throw new Error(`the recording still names ${left.join(", ")}`);
	return scrubbed;
}

/** Checked on every machine, not only the one that recorded. */
export const PRIVATE = [
	homedir(),
	"pi-rig-",
	"worktrees",
	"/node_modules/.bun",
	"/home/",
	"/Users/",
	"/tmp/",
] as const;

/** What the scripted model answers: the run itself, with one card on the board, and pi's summaries. */
function answer(): AssistantMessage {
	runs++;
	if (runs === 1) {
		return fauxAssistantMessage(
			[
				fauxThinking("The log is in the events folder, one JSON line per fact."),
				fauxText("I will list the folder."),
				fauxToolCall("board", { op: "add", title: "Read the rig log", column: "doing" }),
				fauxToolCall("bash", { command: "ls" }),
			],
			{ stopReason: "toolUse" },
		);
	}
	return fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" });
}

async function record(): Promise<void> {
	const rig = await createRig({
		answer,
		extensions: [
			(pi) => {
				createApp(pi, { name: "pi-harness" }).use(names()).use(board).build();
			},
		],
	});

	try {
		// A turn with thinking, a card on the board and a tool call.
		await rig.prompt("List what is in this folder.");
		const first = rig.session.sessionManager.getBranch()[0];
		// A second turn, plain.
		await rig.prompt("Now read the log.");
		// `branch` only moves the leaf, so a third turn is needed for the file to show the move.
		if (first !== undefined) rig.session.sessionManager.branch(first.id);
		await rig.prompt("What did the first turn leave?");
		// An aborted turn and a compaction need timing the scripted model does not control. They are
		// written by hand in the protocol's reducer tests, from lines captured out of a real run.
	} finally {
		mkdirSync(out, { recursive: true });
		const private_ = [rig.root, process.cwd(), dirname(process.cwd()), homedir()];
		const settle = (from: string) => scrub(readFileSync(from, "utf8"), private_);
		const session = rig.session.sessionFile;
		if (session !== undefined) writeFileSync(join(out, "session.jsonl"), settle(session));
		writeFileSync(
			join(out, "harness.jsonl"),
			settle(logPath({ dir: eventsDir(rig.cwd, rig.events), session: rig.session.sessionId })),
		);
		writeFileSync(
			join(out, "README.md"),
			`# A recorded session\n\nWritten by \`bun scripts/record-session.ts\`. A scripted model ran three\nturns: the first with thinking, a card on the board and a tool call, the other two plain. Between the second and the third, the tree moved back to the first entry, so the\nthird turn hangs from an older entry than the one before it. \`session.jsonl\` is pi's file and\n\`harness.jsonl\` is the harness's log. The reducers in \`test/transcript.test.ts\` rebuild both.\n\nAn aborted turn and a compaction are not here: the scripted model cannot be stopped mid answer,\nand pi refuses to compact a session this short. \`test/edges.test.ts\` covers them with lines\ncaptured from a real run.\n`,
		);
		console.log(`wrote ${out}`);
		rig.dispose();
	}
}

if (import.meta.main) await record();

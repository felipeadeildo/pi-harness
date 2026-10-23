import { describe, expect, test } from "bun:test";
// The recording from P1, read back the way a client reads it: the branch ending at the leaf, the
// tasks out of the log, and nothing invented on the way.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { reduceFacts } from "../src/reduce/state.ts";
import {
	transcriptOf,
	type ChatMessage,
	type Entry,
	type TranscriptItem,
} from "../src/reduce/transcript.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "recording");

function lines(name: string): Record<string, unknown>[] {
	return readFileSync(join(FIXTURE, name), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** pi's session file starts with a header, which is not an entry of the tree. */
const entries = lines("session.jsonl").filter(
	(entry) => entry.type !== "session",
) as unknown as Entry[];
const facts = lines("harness.jsonl") as { type: string; data: unknown }[];

/** What a screen reads of an item, without the timestamps that move between recordings. */
function drawn(item: TranscriptItem): string {
	switch (item.kind) {
		case "message": {
			const message = item.message as ChatMessage;
			const text =
				typeof message.content === "string" ? message.content : JSON.stringify(message.content);
			return `${item.kind} ${message.role} ${message.stopReason ?? ""} ${text.slice(0, 80)}`;
		}
		case "model":
			return `${item.kind} ${item.provider}/${item.model}`;
		case "thinking":
			return `${item.kind} ${item.level}`;
		case "custom":
			return `${item.kind} ${item.customType}`;
		default:
			return item.kind;
	}
}

describe("the recording, read back", () => {
	test("the branch ends where the last turn left it", () => {
		const transcript = transcriptOf(entries);

		expect(transcript.leaf).toBe(entries.at(-1)?.id);
		expect(transcript.items.map(drawn)).toMatchSnapshot();
	});

	test("a leaf moved back in the tree drops the turn written after it", () => {
		const moved = transcriptOf(entries, entries[0]?.id);

		// The first entry is the model change, the root of the branch: nothing hangs below it but the
		// session's start, so only what a reader needs to draw the top of the session comes back.
		expect(moved.items.length).toBeLessThan(transcriptOf(entries).items.length);
		expect(moved.leaf).toBe(entries[0]?.id);
	});

	test("the tasks come out of the log with the handle the session was given", () => {
		const state = reduceFacts(facts);

		expect(state.tasks?.handle).toBe("rig");
		expect(state.tasks?.title).toBe("Read the rig log");
		expect(state.tasks?.tasks).toEqual([]);
	});

	test("a log with no rulings and no questions leaves both empty, until A2 and A3 record them", () => {
		const state = reduceFacts(facts);

		expect(state.rulings).toEqual({});
		expect(state.asks).toEqual({});
		expect(state.mode).toBeUndefined();
	});
});

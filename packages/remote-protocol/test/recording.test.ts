import { describe, expect, test } from "bun:test";
// The recording from P1, read back the way a client reads it: the branch ending at the leaf, the
// tasks out of the log, and nothing invented on the way.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { foldLogged } from "../src/reduce/state.ts";
import {
	branchOf,
	transcriptOf,
	type ChatMessage,
	type Entry,
	type TranscriptItem,
} from "../src/reduce/transcript.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "recording");

function customMessage(id: string, display: boolean): Entry {
	const content = "hi";
	return {
		id,
		parentId: null,
		type: "custom_message",
		customType: "pi-peers:message",
		content,
		display,
	} as Entry;
}

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
		// A leaf in the middle of the tree, which is the case a moved leaf makes: the answer to the
		// second turn, which pi wrote after the tasks feature's custom entry.
		const says = (entry: Entry, text: string): boolean =>
			(JSON.stringify((entry as unknown as { message?: unknown }).message) ?? "").includes(text);
		const secondTurn = entries.find((entry) => says(entry, "Now read the log"));
		expect(secondTurn).toBeDefined();
		if (secondTurn === undefined) return;
		const branchOfSecond = entries.find(
			(entry) =>
				entry.type === "message" &&
				says(entry, "Done.") &&
				branchOf(entries, entry.id).some((walked) => walked.id === secondTurn.id),
		);
		expect(branchOfSecond).toBeDefined();
		const moved = transcriptOf(entries, branchOfSecond?.id);

		expect(moved.leaf).toBe(branchOfSecond?.id);
		const messages = moved.items
			.filter((item) => item.kind === "message")
			.map((item) => JSON.stringify((item as { message: ChatMessage }).message));
		// The branch holds the first two turns, in order, and not the one written after the move.
		expect(messages.some((text) => text.includes("List what is in this folder"))).toBe(true);
		expect(messages.some((text) => text.includes("Now read the log"))).toBe(true);
		expect(messages.some((text) => text.includes("What did the first turn leave"))).toBe(false);
	});

	test("a leaf nobody wrote yields no branch, since there is nothing to walk from", () => {
		expect(transcriptOf(entries, "entry-that-does-not-exist")).toEqual({ items: [] });
	});

	test("an entry type pi adds later is drawn as what it is, not as a usage entry", () => {
		const unknown = {
			id: "x",
			parentId: null,
			type: "something_new",
			timestamp: "2026-01-01T00:00:00.000Z",
		};
		expect(transcriptOf([unknown]).items).toEqual([
			{ kind: "other", entry: "x", at: "2026-01-01T00:00:00.000Z", type: "something_new" },
		]);
	});

	test("a message an extension put in the chat says whether pi shows it", () => {
		const [shown] = transcriptOf([customMessage("a", true)]).items;
		const [hidden] = transcriptOf([customMessage("b", false)]).items;
		expect(shown).toMatchObject({ kind: "custom", display: true });
		expect(hidden).not.toHaveProperty("display");
	});

	test("the tasks come out of the log with the handle the session was given", () => {
		const state = foldLogged(facts);

		expect(state.tasks?.handle).toBe("rig");
		expect(state.tasks?.title).toBe("Read the rig log");
		expect(state.tasks?.tasks).toEqual([]);
	});

	test("a log with no rulings and no questions leaves both empty, until A2 and A3 record them", () => {
		const state = foldLogged(facts);

		expect(state.permissions.rulings).toEqual({});
		expect(state.questions).toEqual({});
		expect(state.permissions.mode).toBeUndefined();
	});
});

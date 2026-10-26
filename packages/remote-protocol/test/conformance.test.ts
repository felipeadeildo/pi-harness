// Proves at compile time that the protocol's copies match what the kit writes. `bun run check` is
// the judge: a drifted copy still passes `bun test`.
import { describe, expect, test } from "bun:test";

import { blockedText, isLetter, type BoardBlocker } from "@adeildo/pi-kit";
import type {
	AskQuestion as KitAskQuestion,
	AskResult as KitAskResult,
	By as KitBy,
	CallRuling as KitRuling,
	Letter as KitLetter,
	LogEventMap,
} from "@adeildo/pi-kit";

import { blockedOf } from "../src/board-view.ts";
import type { By } from "../src/by.ts";
import { STATE_CHANGES } from "../src/reduce/entry.ts";
import {
	type AskQuestion,
	type AskResult,
	type CallRuling,
	type StateChangeMap,
	type StateChangeType,
} from "../src/state-changes.ts";
import { type QueuedMessage, isQueuedMessage } from "../src/summary.ts";

/** A value of the kit's shape must always be readable as our copy, never the other way round. */
const copyOfBy = (by: KitBy): By => by;
const copyOfResult = (result: KitAskResult): AskResult => result;
const copyOfQuestion = (question: KitAskQuestion): AskQuestion => question;
const copyOfRuling = (ruling: KitRuling): CallRuling => ruling;

// `session.state` and `session.named` are left out: the bridge rewrites both for the wire.
const IN_THE_KIT = ["ask.opened", "ask.closed", "call.ruled", "mode.changed"] as const;

type InTheKit = (typeof IN_THE_KIT)[number];

const fromTheKit: Pick<LogEventMap, InTheKit> = {
	"ask.opened": { id: "ask", source: "ask-questions", questions: [] },
	"ask.closed": { id: "ask", result: { answers: [], cancelled: false } },
	"call.ruled": {
		toolCallId: "tool:1",
		ruling: { tone: "success", head: "the rule allows it", detail: "bash" },
	},
	"mode.changed": { mode: "edits" },
};

const openedFact: StateChangeMap["ask.opened"] = fromTheKit["ask.opened"];
const closedFact: StateChangeMap["ask.closed"] = fromTheKit["ask.closed"];

describe("the protocol's copies match the kit", () => {
	test("a fact the kit logs reads as the copy, field for field", () => {
		expect(openedFact.id).toBe("ask");
		expect(closedFact.result.cancelled).toBe(false);
	});

	test("every fact it names is one it can tell apart, and the kit's are a subset", () => {
		expect(new Set(STATE_CHANGES).size).toBe(STATE_CHANGES.length);
		for (const type of IN_THE_KIT) expect(STATE_CHANGES).toContain(type as StateChangeType);
	});

	test("the reasons a letter waits are the ones the kit's own validator accepts", () => {
		// The kit's validator is the source of truth for the copied list.
		const by = { kind: "client" as const, name: "phone", machine: "here" };
		const letter = { id: "l1", by, text: "hold on", want: "followUp" as const, at: 3 };
		for (const why of ["asleep", "quiet", "full", "stopped"] as const) {
			expect(isLetter({ ...letter, why })).toBe(true);
			expect(isQueuedMessage({ ...letter, when: 3, why })).toBe(true);
		}
		expect(isLetter({ ...letter, why: "waiting" })).toBe(false);
		expect(isQueuedMessage({ ...letter, when: 3, why: "waiting" } as never)).toBe(false);
	});

	test("a letter becomes a queued letter by renaming its time, and nothing else", () => {
		const by = { kind: "client" as const, name: "phone", machine: "here" };
		const queued = (letter: KitLetter): QueuedMessage => ({
			id: letter.id,
			by: letter.by,
			text: letter.text,
			want: letter.want,
			when: letter.at ?? 0,
			...(letter.why === undefined ? {} : { why: letter.why }),
		});
		expect(queued({ id: "l1", by, text: "hold on", want: "followUp", at: 3 }).when).toBe(3);
	});

	test("the kit's values read as the copies", () => {
		expect(copyOfBy({ kind: "terminal", name: "rig", machine: "here" }).name).toBe("rig");
		expect(copyOfResult({ answers: [], cancelled: true }).cancelled).toBe(true);
		expect(copyOfQuestion({ header: "h", question: "q", options: [] }).header).toBe("h");
		expect(copyOfRuling({ tone: "pending", head: "asking you" }).head).toBe("asking you");
	});
});

describe("the words a blocked card reads with", () => {
	/** Every shape of blocker this protocol carries, each in the reader the phone has. */
	const blockers: readonly BoardBlocker[] = [
		{ on: "operator", why: "say go" },
		{ on: "outside", why: "the release" },
		{ on: "agent", handle: "otter", why: "review" },
	];

	test("the protocol says the same sentence the kit does, for the reader that reads it", () => {
		for (const blocked of blockers)
			expect(blockedOf(blocked, "operator")).toBe(blockedText(blocked, "operator"));
	});
});

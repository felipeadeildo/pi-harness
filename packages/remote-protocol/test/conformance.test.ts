// The copies are only safe while they match. This file imports the kit's types and proves, at compile
// time, that everything the protocol reads out of the log is a shape the kit actually writes.
// The proof here is a type proof, and the judge is `tsc`: revert a field of a copy or add a
// required one to the kit, and `bun test` still passes while `bun run check` fails. Run the check.
import { describe, expect, test } from "bun:test";

import { isLetter } from "@adeildo/pi-kit";
import type {
	AskQuestion as KitAskQuestion,
	AskResult as KitAskResult,
	By as KitBy,
	CallRuling as KitRuling,
	Letter as KitLetter,
	LogEventMap,
	SessionTasks as KitTasks,
} from "@adeildo/pi-kit";

import type { By } from "../src/by.ts";
import {
	FACT_TYPES,
	type AskQuestion,
	type AskResult,
	type CallRuling,
	type FactMap,
	type FactType,
	type SessionTasks,
} from "../src/facts.ts";
import { type QueuedMessage, isQueuedMessage } from "../src/snapshot.ts";

/** A value of the kit's shape must always be readable as our copy, never the other way round. */
const copyOfBy = (by: KitBy): By => by;
const copyOfTasks = (tasks: KitTasks): SessionTasks => tasks;
const copyOfResult = (result: KitAskResult): AskResult => result;
const copyOfQuestion = (question: KitAskQuestion): AskQuestion => question;
const copyOfRuling = (ruling: KitRuling): CallRuling => ruling;

/**
 * The facts the kit's log writes today. The rest of `FACT_TYPES` comes from the bridge and the
 * daemon, which have no log of their own: `session.live`, `session.gone`, `stream.bound`,
 * `leaf.changed` and `prompt.received`. `call.ruled` and `mode.changed` join the kit's log with A3,
 * and `session.renamed` with N3. `session.state` and `session.named` are left out on purpose: the
 * bridge rewrites both for the wire (`running`/`idle` becomes the client's five states, and the
 * title becomes the handle), so the copy here is not the kit's shape and the bridge's decoder is
 * what holds the pair together.
 */
const IN_THE_KIT = [
	"tasks.changed",
	"ask.opened",
	"ask.closed",
	"call.ruled",
	"mode.changed",
] as const;

type InTheKit = (typeof IN_THE_KIT)[number];

const fromTheKit: Pick<LogEventMap, InTheKit> = {
	"tasks.changed": {
		state: { version: 1, tasks: [], decisions: [], nextTask: 1, nextDecision: 1, updatedAt: 0 },
	},
	"ask.opened": { id: "ask", source: "ask-questions", questions: [] },
	"ask.closed": { id: "ask", result: { answers: [], cancelled: false } },
	"call.ruled": {
		toolCallId: "tool:1",
		ruling: { tone: "success", head: "the rule allows it", detail: "bash" },
	},
	"mode.changed": { mode: "edits" },
};

// Each line is the proof: the kit's fact is assigned to the copy, so a field missing here is a
// compile error. A generic would say the same and prove less, since it would need a constraint
// narrow enough to be the answer.
const tasksFact: FactMap["tasks.changed"] = fromTheKit["tasks.changed"];
const openedFact: FactMap["ask.opened"] = fromTheKit["ask.opened"];
const closedFact: FactMap["ask.closed"] = fromTheKit["ask.closed"];

describe("the protocol's copies match the kit", () => {
	test("a fact the kit logs reads as the copy, field for field", () => {
		expect(tasksFact.state.nextTask).toBe(1);
		expect(openedFact.id).toBe("ask");
		expect(closedFact.result.cancelled).toBe(false);
	});

	test("every fact it names is one it can tell apart, and the kit's are a subset", () => {
		expect(new Set(FACT_TYPES).size).toBe(FACT_TYPES.length);
		for (const type of IN_THE_KIT) expect(FACT_TYPES).toContain(type as FactType);
	});

	test("the reasons a letter waits are the ones the kit's own validator accepts", () => {
		// The list is a copy, because the protocol cannot import the kit. The kit's validator is the
		// source of truth, so every reason here has to be one it accepts, and an invented one has to
		// be refused by both sides.
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
		expect(copyOfTasks(fromTheKit["tasks.changed"].state).nextTask).toBe(1);
		expect(copyOfResult({ answers: [], cancelled: true }).cancelled).toBe(true);
		expect(copyOfQuestion({ header: "h", question: "q", options: [] }).header).toBe("h");
		expect(copyOfRuling({ tone: "pending", head: "asking you" }).head).toBe("asking you");
	});
});

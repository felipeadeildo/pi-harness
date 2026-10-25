import { describe, expect, test } from "bun:test";

import { ANSWER, ASK, type AnswerEvent, AVAILABLE, CANCEL, type By } from "@adeildo/pi-kit";
import { emptySessionState, isStateChangeType, applyChange } from "@adeildo/pi-remote-protocol";
import { createEventBus } from "@earendil-works/pi-coding-agent";

import { ClientAsks, OpenAsks } from "../src/bridge/asks.ts";

const CLIENT: By = { kind: "client", name: "my phone", machine: "phone" };
const CANCELLED = { answers: [], cancelled: true };
const QUESTION = { id: "q1", questions: [{ question: "Which one?", header: "One", options: [] }] };

/** The bridge's side of the questions, on a bus of its own. */
function mounted() {
	const events = createEventBus();
	const sent: { type: string; data: unknown }[] = [];
	const warns: string[] = [];
	const asks = new ClientAsks({
		events,
		send: (event) => sent.push(event),
		warn: (w) => warns.push(w),
	});
	asks.start();
	const answered: AnswerEvent[] = [];
	events.on(ANSWER, (data: unknown) => answered.push(data as AnswerEvent));
	return { events, sent, warns, asks, answered };
}

describe("the questions of a session with no terminal", () => {
	test("the bridge answers the kit's availability, so the features ask instead of drawing", () => {
		const { events } = mounted();
		const probe = { available: false };
		events.emit(AVAILABLE, probe);
		expect(probe.available).toBe(true);
	});

	test("a question is heard, and an answer on the bus sends no second fact", () => {
		const { events, sent } = mounted();
		events.emit(ASK, QUESTION);
		// Nothing goes on the wire from here: the ask client logs both halves, and the bridge
		// forwards the log. A second producer meant a second copy that could erase the author.
		expect(sent).toEqual([]);

		events.emit(ANSWER, { id: "q1", by: CLIENT, result: { answers: [], cancelled: false } });
		expect(sent).toEqual([]);
	});

	test("a question answered elsewhere closes the clients' dialog and sends no answer", () => {
		const { events, sent, answered } = mounted();
		events.emit(ASK, QUESTION);
		events.emit(CANCEL, { id: "q1", by: { kind: "terminal", name: "other", machine: "box" } });
		expect(answered).toEqual([]);
		expect(sent).toEqual([]);
	});

	test("a question with no id is refused with a warning instead of a dialog nobody can answer", () => {
		const { events, sent, warns } = mounted();
		events.emit(ASK, { questions: [] });
		expect(sent).toEqual([]);
		expect(warns).toEqual(["a question with no id, so no client can answer it"]);
	});

	test("stopping it takes the bridge out of the bus", () => {
		const { events, sent, asks } = mounted();
		asks.stop();
		events.emit(ASK, QUESTION);
		expect(sent).toEqual([]);
	});

	test("every close also reaches the session's status, which watches the bus and not the fact", () => {
		const { events, asks } = mounted();
		const cancelled: unknown[] = [];
		events.on(CANCEL, (data: unknown) => cancelled.push(data));
		events.emit(ASK, QUESTION);
		events.emit(ASK, { ...QUESTION, id: "q2" });
		asks.stop();
		// Without these the session stays blocked on questions nobody waits for any more.
		expect(cancelled).toEqual([{ id: "q1" }, { id: "q2" }]);
	});

	test("a stop writes the one close the log cannot, so no client keeps a dead dialog", () => {
		const { events, sent, asks } = mounted();
		events.emit(ASK, { ...QUESTION, id: "q1" });
		events.emit(ASK, { ...QUESTION, id: "q2" });
		// q1 is answered, so the ask client logged its close and the bridge has nothing to add.
		events.emit(ANSWER, { id: "q1", by: CLIENT, result: { answers: [], cancelled: false } });
		expect(sent).toEqual([]);

		asks.stop();
		// q2 was still open when the session went: no answer, no abort, no log line. The bridge is the
		// only one that can say it closed, and a fact without a `result` never reads.
		expect(sent).toEqual([{ type: "ask.closed", data: { id: "q2", result: CANCELLED } }]);
		let facts = emptySessionState();
		for (const event of sent) {
			expect(isStateChangeType(event.type)).toBe(true);
			facts = isStateChangeType(event.type) ? applyChange(facts, event.type, event.data) : facts;
		}
		expect(Object.values(facts.questions).filter((one) => one.closed === undefined)).toEqual([]);
	});

	test("a stop closes the questions a session has open, and not the ones already answered", () => {
		const events = createEventBus();
		const open = new OpenAsks();
		open.watch(events);
		// The question the session has to close as a no before it aborts, and two that are done.
		events.emit(ASK, QUESTION);
		events.emit(ASK, { ...QUESTION, id: "answered" });
		events.emit(ANSWER, { id: "answered", result: { answers: [] } });
		events.emit(ASK, { ...QUESTION, id: "cancelled" });
		events.emit(CANCEL, { id: "cancelled" });
		expect(open.open).toEqual(["q1"]);
	});
});

import { describe, expect, test } from "bun:test";

import { ANSWER, ASK, type AnswerEvent, AVAILABLE, CANCEL, type By } from "@adeildo/pi-kit";
import { emptySessionFacts, isFact, reduceFact } from "@adeildo/pi-remote-protocol";
import { createEventBus } from "@earendil-works/pi-coding-agent";

import { ClientAsks, OpenAsks } from "../src/bridge/asks.ts";

const CLIENT: By = { kind: "client", name: "my phone", machine: "phone" };
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

	test("a question goes to the clients, and a client's answer goes back on the bus with its name", () => {
		const { events, sent, asks, answered } = mounted();
		events.emit(ASK, QUESTION);
		expect(sent).toEqual([{ type: "ask.opened", data: QUESTION }]);
		expect(asks.waiting).toEqual(["q1"]);

		expect(asks.answer({ ask: "q1", by: CLIENT, result: { answers: [], cancelled: false } })).toBe(
			true,
		);
		expect(answered).toEqual([{ id: "q1", by: CLIENT, result: { answers: [], cancelled: false } }]);
		expect(sent.at(-1)).toMatchObject({
			type: "ask.closed",
			data: { id: "q1", by: CLIENT, result: { answers: [], cancelled: false } },
		});
		expect(asks.waiting).toEqual([]);
	});

	test("only the first answer counts, and one for a question nobody asked changes nothing", () => {
		const { events, asks, answered } = mounted();
		events.emit(ASK, QUESTION);
		const first = { ask: "q1", by: CLIENT, result: { answers: [], cancelled: false } };
		expect(asks.answer(first)).toBe(true);
		expect(asks.answer({ ...first, by: { ...CLIENT, name: "another" } })).toBe(false);
		expect(asks.answer({ ...first, ask: "gone" })).toBe(false);
		expect(answered).toHaveLength(1);
		expect(answered[0]?.by).toEqual(CLIENT);
	});

	test("a question answered elsewhere closes the clients' dialog and sends no answer", () => {
		const { events, sent, asks, answered } = mounted();
		events.emit(ASK, QUESTION);
		events.emit(CANCEL, { id: "q1", by: { kind: "terminal", name: "other", machine: "box" } });
		expect(asks.waiting).toEqual([]);
		expect(answered).toEqual([]);
		expect(sent.at(-1)).toMatchObject({
			type: "ask.closed",
			data: { id: "q1", result: { answers: [], cancelled: true } },
		});
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
		asks.answer({ ask: "q1", by: CLIENT, result: { answers: [], cancelled: false } });
		events.emit(ASK, { ...QUESTION, id: "q2" });
		asks.stop();
		// Without these the session stays blocked on questions nobody waits for any more.
		expect(cancelled).toEqual([{ id: "q1", by: CLIENT }, { id: "q2" }]);
	});

	test("what it sends closes the question in a client's state, answered or cancelled", () => {
		const { events, sent, asks } = mounted();
		events.emit(ASK, QUESTION);
		asks.answer({ ask: "q1", by: CLIENT, result: { answers: [], cancelled: false } });
		events.emit(ASK, { ...QUESTION, id: "q2" });
		asks.stop();

		// The fact only reads with a `result`, so a close without one leaves the question open in the
		// client's state, with a dialog nobody can answer any more.
		let facts = emptySessionFacts();
		for (const event of sent) {
			if (event.type !== "ask.opened" && event.type !== "ask.closed") continue;
			expect(isFact(event.type, event.data)).toBe(true);
			facts = reduceFact(facts, event.type, event.data);
		}
		expect(Object.values(facts.asks).filter((one) => one.closed === undefined)).toEqual([]);
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

// What the inbox holds, and in which order: a steer goes in at once, a follow-up waits for the agent
// to settle, what waits can be taken back, and the operator's words come before an agent's.
import { describe, expect, test } from "bun:test";

import { INBOX, INBOX_PORT, inboxPort } from "../src/contracts/inbox.ts";
import { Inbox } from "../src/inbox/inbox.ts";
import { type Letter, isLetter } from "../src/inbox/letter.ts";
import { fakeScope } from "../src/testing.ts";

const OPERATOR = { kind: "client", name: "phone", machine: "laptop" } as const;
const AGENT = { kind: "agent", name: "otter", machine: "laptop" } as const;

let next = 0;
function letter(
	text: string,
	by: Letter["by"] = OPERATOR,
	want: Letter["want"] = "followUp",
	at?: number,
): Letter {
	next += 1;
	return { id: `l${next}`, by, text, want, ...(at === undefined ? {} : { at }) };
}

describe("the inbox", () => {
	test("holds a follow-up and keeps a steer on its way, in one queue and one list", () => {
		const inbox = new Inbox();
		const follow = letter("later", OPERATOR, "followUp");
		const steer = letter("now", OPERATOR, "steer");
		inbox.put(follow);
		inbox.put(steer);
		expect(inbox.queue().map((one) => one.id)).toEqual([follow.id]);
		expect(inbox.sent().map((one) => one.id)).toEqual([steer.id]);
	});

	test("puts a resend of the same letter nowhere, so a retry is not a second message", () => {
		const inbox = new Inbox();
		const once = letter("hello");
		inbox.put(once);
		inbox.put(once);
		expect(inbox.queue()).toHaveLength(1);
		inbox.take();
		inbox.put(once);
		expect(inbox.queue()).toEqual([]);
		expect(inbox.seen(once.id)).toBe(true);
	});

	test("takes one letter back, and the others stay in the order they go in", () => {
		const inbox = new Inbox();
		const first = letter("first");
		const second = letter("second", AGENT);
		inbox.put(first);
		inbox.put(second);
		expect(inbox.take([second.id]).map((one) => one.text)).toEqual(["second"]);
		expect(inbox.queue().map((one) => one.text)).toEqual(["first"]);
	});

	test("settles with the operator's words first, then the agents', each in its own order", () => {
		const inbox = new Inbox();
		const fromAgent = letter("from an agent", AGENT);
		const first = letter("first");
		const second = letter("second");
		// A steer went to pi when it was put, so the run it joins does not carry it again.
		const steer = letter("steer", OPERATOR, "steer");
		const waiting = letter("from the operator", OPERATOR);
		const lastAgent = letter("another agent", AGENT);
		for (const one of [fromAgent, first, second, steer, lastAgent, waiting]) inbox.put(one);
		const letters = inbox.settle();
		// Inside each group, the order they were written in.
		expect(letters.map((one) => one.text)).toEqual([
			"first",
			"second",
			"from the operator",
			"from an agent",
			"another agent",
		]);
		expect(inbox.queue()).toEqual([]);
		expect(inbox.sent()).toEqual([]);
	});

	test("a steer put twice is one steer, and the one the Esc sends back can go again", () => {
		const inbox = new Inbox();
		const steer = letter("steer", OPERATOR, "steer");
		inbox.put(steer);
		inbox.put(steer);
		expect(inbox.sent().map((one) => one.id)).toEqual([steer.id]);
		expect(inbox.seen(steer.id)).toBe(true);

		// The Esc gives it back: it is not a repeat any more, so putting it again works.
		const { resend } = inbox.cleared([steer], true);
		expect(resend.map((one) => one.id)).toEqual([steer.id]);
		expect(inbox.seen(steer.id)).toBe(false);
		inbox.put(steer);
		expect(inbox.sent().map((one) => one.id)).toEqual([steer.id]);
	});

	test("the Esc puts a steer back in the run, and keeps it for the next one when the run stopped", () => {
		const inbox = new Inbox();
		const steer = letter("steer", OPERATOR, "steer");
		inbox.put(steer);
		const running = inbox.cleared([steer], true);
		expect(running.resend.map((one) => one.id)).toEqual([steer.id]);
		expect(inbox.queue()).toEqual([]);

		inbox.put(steer);
		const stopped = inbox.cleared([steer], false);
		expect(stopped.resend).toEqual([]);
		expect(stopped.held).toMatchObject([{ id: steer.id, why: "stopped" }]);
		expect(inbox.queue()).toMatchObject([{ id: steer.id, why: "stopped" }]);
	});

	test("a steered letter the Esc sent back is taken again, and one a run carried is a repeat", () => {
		const inbox = new Inbox();
		const steer = letter("steer", OPERATOR, "steer");
		inbox.put(steer);
		expect(inbox.cleared([steer], true).resend.map((one) => one.id)).toEqual([steer.id]);
		// It never went into a run, so the same letter is not a repeat and can be sent again.
		expect(inbox.seen(steer.id)).toBe(false);
		inbox.put(steer);
		expect(inbox.sent().map((one) => one.id)).toEqual([steer.id]);

		// What a run carried is a repeat until that run ends, which is what stops a resend of it.
		const follow = letter("follow", AGENT);
		inbox.put(follow);
		inbox.settle();
		expect(inbox.seen(follow.id)).toBe(true);
		inbox.put(follow);
		expect(inbox.queue()).toEqual([]);
		inbox.ended();
		expect(inbox.seen(follow.id)).toBe(false);
	});

	test("a letter without a time gets one when it comes in, from the inbox's clock", () => {
		const inbox = new Inbox(() => 1_000);
		inbox.put(letter("a", AGENT));
		inbox.put(letter("b", OPERATOR, "steer"));
		expect(inbox.queue()[0]?.at).toBe(1_000);
		expect(inbox.sent()[0]?.at).toBe(1_000);
		// A writer that carries its own clock keeps it, and a zero is a time, not a missing one.
		const early = letter("early", AGENT, "followUp", 5);
		const zero = letter("zero", AGENT, "followUp", 0);
		inbox.put(early);
		inbox.put(zero);
		expect(inbox.queue().find((one) => one.id === early.id)?.at).toBe(5);
		expect(inbox.queue().find((one) => one.id === zero.id)?.at).toBe(0);
	});

	test("a letter held for a reason reads back with it, and one without reads as it was", () => {
		const inbox = new Inbox();
		inbox.put(letter("asleep", AGENT));
		inbox.holdFor(letter("plain", AGENT), undefined);
		expect(inbox.queue().map((one) => one.why)).toEqual([undefined, undefined]);
		const held = new Inbox();
		held.holdFor(letter("quiet", AGENT), "quiet");
		expect(held.queue()).toMatchObject([{ why: "quiet" }]);
	});

	test("a letter a run already carried never comes back, whatever reason arrives late", () => {
		const inbox = new Inbox();
		const carried = letter("carried");
		inbox.put(carried);
		inbox.take([carried.id]);
		// A reason learned after the delivery must not resurrect the message: the run is answering it.
		inbox.holdFor(carried, "stopped");
		expect(inbox.queue()).toEqual([]);
	});

	test("holding the same letter again keeps its place and takes the latest reason", () => {
		const inbox = new Inbox();
		const first = letter("first");
		const second = letter("second");
		inbox.holdFor(first, "quiet");
		inbox.holdFor(second, "quiet");
		// The reason can be learned later than the holding, and the line a screen draws is the place.
		inbox.holdFor(first, "not-started");
		expect(inbox.queue().map((one) => [one.id, one.why])).toEqual([
			[first.id, "not-started"],
			[second.id, "quiet"],
		]);
	});

	test("holds again what a run did not carry, in the order it arrived", () => {
		const inbox = new Inbox();
		const first = letter("first");
		const second = letter("second");
		inbox.put(first);
		inbox.put(second);
		const letters = inbox.settle();
		// pi took the steer and none of the follow-ups, which the operator's Esc emptied.
		inbox.hold(letters.filter((one) => one.want === "followUp"));
		expect(inbox.queue().map((one) => one.text)).toEqual(["first", "second"]);
		// A steer is inside pi already: it does not come back as something to send.
		expect(inbox.queue().some((one) => one.want === "steer")).toBe(false);
	});

	test("forgets the repeats of a run that ended, so the same words go in again next time", () => {
		const inbox = new Inbox();
		const once = letter("hello");
		inbox.put(once);
		inbox.settle();
		inbox.put(once);
		expect(inbox.queue()).toEqual([]);
		inbox.ended();
		inbox.put(once);
		expect(inbox.queue().map((one) => one.id)).toEqual([once.id]);
	});

	test("starts a new run with nothing held and no repeats remembered", () => {
		const inbox = new Inbox();
		inbox.put(letter("a"));
		inbox.put(letter("b", OPERATOR, "steer"));
		inbox.reset();
		expect(inbox.queue()).toEqual([]);
		expect(inbox.sent()).toEqual([]);
	});
});

describe("a letter over the bus", () => {
	test("reads what a client sends, and refuses what is not a letter", () => {
		const one = letter("hello");
		expect(isLetter(one)).toBe(true);
		expect(isLetter({ ...one, want: "whenever" })).toBe(false);
		expect(isLetter({ ...one, by: { kind: "phone" } })).toBe(false);
		expect(isLetter({ ...one, id: "" })).toBe(false);
		const custom = { ...one, custom: { customType: "peers:room", details: { room: "r" } } };
		expect(isLetter(custom)).toBe(true);
	});

	test("the queue and the steers are one value the client can mirror", () => {
		const scope = fakeScope();
		const inbox = new Inbox();
		const held = letter("held");
		const steer = letter("steer", OPERATOR, "steer");
		inbox.put(held);
		inbox.put(steer);
		INBOX.provide(scope, () => ({ queue: inbox.queue(), sent: [...inbox.sent()] }));
		expect(INBOX.current(scope)?.queue.map((one) => one.text)).toEqual(["held"]);
		expect(INBOX.current(scope)?.sent.map((one) => one.text)).toEqual(["steer"]);
	});

	test("a feature puts a letter in through the port, without importing the inbox", () => {
		const scope = fakeScope();
		const inbox = new Inbox();
		INBOX_PORT.provide(scope, () => ({
			put: (one) => inbox.put(one),
			take: (ids) => inbox.take(ids),
		}));
		const port = inboxPort(scope);
		if (port === undefined) throw new Error("no port");
		const one = letter("through the port");
		port.put(one);
		// The inbox stamps the time, so a writer need not carry one.
		expect(INBOX_PORT.current(scope)?.take()).toMatchObject([
			{ id: one.id, text: one.text, want: one.want },
		]);
	});

	test("a change of the queue reaches every listener, decoded", () => {
		const notes: string[] = [];
		const scope = fakeScope({ notes });
		const seen: string[][] = [];
		const stop = INBOX.onChanged(scope, (value) =>
			seen.push(value?.queue.map((one) => one.id) ?? []),
		);
		const one = letter("one");
		INBOX.changed(scope, { queue: [one], sent: [] });
		// A queue holding something that is not a letter is dropped with a warning, not drawn.
		const wrong = { queue: [{ id: "x", by: { kind: "stop" }, text: "t", want: "now" }] };
		INBOX.changed(scope, { ...(wrong as { queue: Letter[] }), sent: [] });
		stop();
		expect(seen).toEqual([[one.id]]);
		expect(notes.join(" ")).toContain("ignored a change of inbox");
	});
});

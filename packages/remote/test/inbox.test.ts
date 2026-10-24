// What a message from a client does on its way into the session: a steer goes to pi at once, a
// follow-up waits for the agent to settle, and what waits can be taken back before it goes.
import { describe, expect, test } from "bun:test";

import { INBOX, INBOX_PORT } from "@adeildo/pi-kit";
import { fakePi } from "@adeildo/pi-kit/testing";
import { envelope } from "@adeildo/pi-remote-protocol";

import { Commands } from "../src/bridge/commands.ts";
import { letterOf, SessionInbox } from "../src/bridge/inbox.ts";

const PHONE = { kind: "client", name: "phone", machine: "laptop" } as const;

/** An inbox over a fake pi's bus, with what reached pi recorded in the order it was sent. */
function wired() {
	const fake = fakePi();
	const scope = { events: fake.pi.events, warn: () => {} };
	const sent: { text: string; deliverAs?: string }[] = [];
	const notes: string[] = [];
	// A run in flight: the default, because most of what the inbox does is what it does while busy.
	const state = { running: true };
	const inbox = new SessionInbox(scope, {
		send: (text, deliverAs) =>
			void sent.push(deliverAs === undefined ? { text } : { text, deliverAs }),
		arrived: (text, by) => void notes.push(`${by.name}: ${text}`),
		busy: () => state.running,
	});
	const stop = inbox.start();
	return { inbox, sent, notes, scope, stop, state };
}

let next = 0;
function letter(text: string, want: "steer" | "followUp" = "followUp") {
	next += 1;
	return { id: `l${next}`, by: PHONE, text, want };
}

describe("a session's inbox", () => {
	test("sends a follow-up at once when no run is in flight, and leaves the queue empty", () => {
		const { inbox, sent, state } = wired();
		state.running = false;
		inbox.put(letter("the first one", "followUp"));
		// Nothing to wait for: the letter starts the run, and a client's queue does not keep it.
		expect(sent).toEqual([{ text: "the first one" }]);
		expect(inbox.queue()).toEqual([]);
	});

	test("sends a steer at once and holds a follow-up until the agent settles", () => {
		const { inbox, sent } = wired();
		inbox.put(letter("now", "steer"));
		inbox.put(letter("later"));
		expect(sent).toEqual([{ text: "now", deliverAs: "steer" }]);
		expect(inbox.queue().map((one) => one.text)).toEqual(["later"]);
	});

	test("sends what waited when the agent settles, the first one as the run and the rest behind it", () => {
		const { inbox, sent } = wired();
		inbox.put(letter("first"));
		inbox.put(letter("second"));
		inbox.settle();
		expect(sent).toEqual([{ text: "first" }, { text: "second", deliverAs: "followUp" }]);
		expect(inbox.queue()).toEqual([]);
	});

	test("does not send a steer twice when the same letter is put again", () => {
		const { inbox, sent } = wired();
		const one = letter("now", "steer");
		inbox.put(one);
		inbox.put(one);
		expect(sent).toEqual([{ text: "now", deliverAs: "steer" }]);
	});

	test("says in the terminal that a prompt came from a client, and keeps quiet for the terminal's own", () => {
		const { inbox, notes } = wired();
		inbox.put(letter("from the phone"));
		inbox.put({
			id: "local",
			by: { kind: "terminal", name: "otter", machine: "laptop" },
			text: "typed here",
			want: "followUp",
		});
		expect(notes).toEqual(["phone: from the phone"]);
	});

	test("sends nothing when the agent settles with an empty queue", () => {
		const { inbox, sent } = wired();
		inbox.settle();
		expect(sent).toEqual([]);
	});

	test("takes a held letter back, and it never reaches pi", () => {
		const { inbox, sent } = wired();
		const one = letter("never mind");
		inbox.put(one);
		expect(inbox.take().map((letter) => letter.id)).toEqual([one.id]);
		inbox.settle();
		expect(sent).toEqual([]);
	});

	test("publishes its queue when it changes, so a client draws what waits", () => {
		const { inbox, scope } = wired();
		const seen: string[][] = [];
		const stop = INBOX.onChanged(scope, (value) =>
			seen.push(value === undefined ? [] : value.queue.map((one) => one.text)),
		);
		inbox.put(letter("held"));
		inbox.take();
		stop();
		expect(seen).toEqual([["held"], []]);
	});

	test("a prompt from a client goes through the inbox, and queue.clear takes back what waits", async () => {
		const { inbox, sent, scope, stop } = wired();
		const answers: { kind: string; data: Record<string, unknown> }[] = [];
		const commands = new Commands({
			session: "s1",
			effects: {
				abort: () => {},
				compact: () => {},
				rename: () => {},
				stop: () => {},
				setModel: () => Promise.resolve(),
				setThinking: () => {},
				setMode: () => {},
				answerAsk: () => {},
				prompt: (id, by, text, deliverAs) => inbox.put(letterOf(id, by, text, deliverAs)),
				clearQueue: () => inbox.take(),
			},
			answer: (kind, _type, data) => answers.push({ kind, data }),
			received: () => {},
			outcome: () => {},
		});
		const by = { kind: "client", name: "phone", machine: "laptop" } as const;
		const send = (id: string, data: Record<string, unknown>) =>
			commands.run(envelope("command", "prompt.send", data, { session: "s1", id, by }));
		await send("p1", { text: "now", deliverAs: "steer" });
		await send("p2", { text: "later" });
		// The steer went in at once, and the follow-up waits for the agent to settle.
		expect(sent).toEqual([{ text: "now", deliverAs: "steer" }]);
		await commands.run(envelope("command", "queue.clear", {}, { session: "s1", id: "q1", by }));
		expect(answers.at(-1)).toMatchObject({ kind: "reply", data: { taken: [{ text: "later" }] } });
		inbox.settle();
		expect(sent).toEqual([{ text: "now", deliverAs: "steer" }]);
		stop();
		void scope;
	});

	test("takes a message from another feature through the port, so peers and clients share the queue", () => {
		const { inbox, scope } = wired();
		const one = letter("from another feature");
		INBOX_PORT.current(scope)?.put(one);
		expect(inbox.queue().map((letter) => letter.id)).toEqual([one.id]);
		// The inbox stamps the letter on the way in, so what comes back carries the time it arrived.
		expect(INBOX_PORT.current(scope)?.take()).toEqual([{ ...one, at: expect.any(Number) }]);
	});
});

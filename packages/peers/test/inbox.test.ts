import { describe, expect, test } from "bun:test";

import type { Delivery, Held } from "@adeildo/pi-kit";

import type { Posted } from "../src/folder.ts";
import { Inbox, type InboxHooks, type Sender, letterOf } from "../src/inbox.ts";
import type { BusyDelivery } from "../src/rules.ts";

function posted(id: string, text: string): Posted {
	return {
		id,
		session: "writer",
		from: "agent",
		to: ["me"],
		text,
		urgent: false,
		depth: 0,
		at: 1_000,
		received: new Map(),
		read: new Set(),
		bids: new Map(),
	};
}

/** An awake inbox for a busy agent, and what it sent, held and logged. */
function busy(mode: BusyDelivery = "steered") {
	const sent: { ids: string[]; options: unknown; display?: boolean }[] = [];
	const held: { ids: string[]; why: Held }[] = [];
	const receipts: { id: string; mode: Delivery }[] = [];
	const state = { idle: false };
	const hooks: InboxHooks = {
		sendMessage: ((message: { details: { items: { id: string }[] }; display?: boolean }, options) =>
			sent.push({
				ids: message.details.items.map((item) => item.id),
				options,
				display: message.display,
			})) as InboxHooks["sendMessage"],
		sendUserMessage: (() => {}) as InboxHooks["sendUserMessage"],
		held: (delivery, why) => held.push({ ids: delivery.items.map((item) => item.id), why }),
		busyDelivery: () => mode,
		idle: () => state.idle,
	};
	const from: Sender = {
		by: { kind: "agent", name: "oauth", machine: "laptop" },
		details: (message) => ({
			id: message.id,
			from: "oauth",
			color: "accent",
			fromYou: false,
			toYou: true,
			text: message.text,
			at: message.at,
		}),
		handed: (messages, how) => {
			for (const message of messages) receipts.push({ id: message.id, mode: how });
		},
	};
	const inbox = new Inbox(hooks);
	inbox.prompted();
	return { inbox, from, sent, held, receipts, state };
}

describe("a colleague's message the agent has not read", () => {
	test("stays queued, with when it goes in, until the model reads it", () => {
		const { inbox, from } = busy();
		inbox.arrive(from, [posted("m1", "are you in auth.ts?")]);
		expect(inbox.queued()).toEqual([
			expect.objectContaining({ id: "m1", mode: "steered", text: "are you in auth.ts?" }),
		]);
		expect(inbox.read("m1")).toBe(true);
		expect(inbox.queued()).toEqual([]);
		expect(inbox.read("m1")).toBe(false);
	});

	test("one for after the run is queued too, and one that wakes the agent is not", () => {
		const after = busy("after-run");
		after.inbox.arrive(after.from, [posted("m1", "later")]);
		expect(after.inbox.queued().map((one) => one.mode)).toEqual(["after-run"]);

		const idle = busy();
		idle.state.idle = true;
		idle.inbox.arrive(idle.from, [posted("m2", "wake up")]);
		expect(idle.inbox.queued()).toEqual([]);
	});

	test("goes back into a run that goes on when pi empties its queue", () => {
		const { inbox, from, sent, held } = busy();
		inbox.arrive(from, [posted("m1", "one")]);
		inbox.cleared(true);
		expect(sent.map((one) => one.options)).toEqual([
			{ triggerTurn: true, deliverAs: "steer" },
			{ triggerTurn: true, deliverAs: "steer" },
		]);
		expect(sent[1]?.ids).toEqual(["m1"]);
		expect(held).toEqual([]);
		expect(inbox.queued().map((one) => one.id)).toEqual(["m1"]);
	});

	test("waits for your next prompt, with why, when you stop the run", () => {
		const { inbox, from, sent, held, receipts } = busy();
		inbox.arrive(from, [posted("m1", "one"), posted("m2", "two")]);
		inbox.cleared(false);
		expect(held).toEqual([{ ids: ["m1", "m2"], why: "stopped" }]);
		// Shown once, by the held entry: the copy for the model is not drawn again.
		expect(sent.at(-1)).toEqual({
			ids: ["m1", "m2"],
			options: { deliverAs: "nextTurn" },
			display: false,
		});
		expect(receipts.slice(-2)).toEqual([
			{ id: "m1", mode: "next-turn" },
			{ id: "m2", mode: "next-turn" },
		]);
		expect(inbox.queued()).toEqual([]);
	});

	test("an empty queue leaves nothing to do", () => {
		const { inbox, sent, held } = busy();
		inbox.cleared(false);
		expect(sent).toEqual([]);
		expect(held).toEqual([]);
	});
});

describe("the letter a message becomes", () => {
	test("carries who wrote it, the words, and when it goes in", () => {
		const by = { kind: "agent", name: "oauth", machine: "laptop" } as const;
		expect(letterOf(posted("m1", "are you in auth.ts?"), by, "steered")).toEqual({
			id: "m1",
			by,
			text: "are you in auth.ts?",
			want: "steer",
			at: 1_000,
		});
		expect(letterOf(posted("m2", "later"), by, "after-run").want).toBe("followUp");
	});
});

test("what waits is also a letter of the kit, ready for the queue to move there", () => {
	const { inbox, from } = busy("after-run");
	inbox.arrive(from, [posted("m1", "are you in auth.ts?"), posted("m2", "later")]);
	const letters = inbox.letters();
	expect(letters.map((one) => [one.id, one.want, one.text])).toEqual([
		["m1", "followUp", "are you in auth.ts?"],
		["m2", "followUp", "later"],
	]);
	expect(letters[0]?.by).toEqual({ kind: "agent", name: "oauth", machine: "laptop" });
	// Reading one takes it out of the kit's queue too, so the two views cannot drift.
	expect(inbox.read("m1")).toBe(true);
	expect(inbox.letters().map((one) => one.id)).toEqual(["m2"]);
});

test("a run that starts takes the queue with it, and the kit's queue is the one that empties", () => {
	const { inbox, from } = busy("after-run");
	inbox.arrive(from, [posted("m1", "later")]);
	expect(inbox.letters().map((one) => one.id)).toEqual(["m1"]);
	inbox.started();
	expect(inbox.letters()).toEqual([]);
	expect(inbox.queued()).toEqual([]);
});

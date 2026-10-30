import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Held, HOST, logEvent, ownStart, readFrom, targetOf, logPath } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Fit } from "../src/bid.ts";
import { Here, type Hooks, PEER_MESSAGE, PEER_NOTE, type PeerMessageDetails } from "../src/here.ts";
import { BID_WINDOW_MS, type BusyDelivery, CHAIN_LIMIT, STEERS_PER_RUN } from "../src/rules.ts";
import { statusLine } from "../src/ui/status.ts";

let root: string;
let now = 1_000_000;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "peers-"));
	process.env.PI_HARNESS_EVENTS = root;
	now = 1_000_000;
});

afterEach(() => {
	for (const here of opened) here.close();
	opened.length = 0;
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(root, { recursive: true, force: true });
});

const opened: Here[] = [];

interface Sent {
	kind: "user" | "custom";
	text: string;
	options?: unknown;
	display?: boolean;
}

/** The quiet notes the agent gets about who else is here, which never start a run. */
interface Note {
	text: string;
	options?: unknown;
	display?: boolean;
}

/** A session in the room; `prompted` says the operator already wrote in it, as most tests need. */
function session(
	id: string,
	fit: Fit = { fit: 0.5, reason: "" },
	prompted = true,
	/** `null` leaves the kit to judge processes, by their pid and their start. */
	alive: Hooks["alive"] | null = () => true,
) {
	const sent: Sent[] = [];
	const notes: Note[] = [];
	const shown: PeerMessageDetails[] = [];
	const held: { from: string[]; why: Held; chain?: number }[] = [];
	const wentIn: { ids: string[]; by: string | undefined }[] = [];
	const limit: { chain: number; busy: BusyDelivery } = { chain: CHAIN_LIMIT, busy: "steered" };
	const state = { idle: true };
	const hooks: Hooks = {
		events: { emit: () => {}, on: () => () => {} } as unknown as Hooks["events"],
		defer: (run) => void setTimeout(run, 0),
		sendMessage: ((
			message: { content: string; customType: string; display?: boolean },
			options: unknown,
		) => {
			if (message.customType === PEER_NOTE) {
				notes.push({ text: message.content, options, display: message.display });
				return;
			}
			expect(message.customType).toBe(PEER_MESSAGE);
			sent.push({ kind: "custom", text: message.content, options, display: message.display });
		}) as Hooks["sendMessage"],
		sendUserMessage: ((text: string, options: unknown) =>
			sent.push({ kind: "user", text, options })) as Hooks["sendUserMessage"],
		idle: () => state.idle,
		fit: async () => fit,
		changed: () => {},
		show: (details) => shown.push(details),
		held: (delivery, why) =>
			held.push({
				from: delivery.items.map((item) => item.text),
				why,
				...(delivery.chain === undefined ? {} : { chain: delivery.chain }),
			}),
		wentIn: (ids, started) => wentIn.push({ ids: [...ids], by: started.by }),
		chainLimit: () => limit.chain,
		busyDelivery: () => limit.busy,
		now: () => now,
		...(alive === null ? {} : { alive }),
	};
	const here = new Here(hooks);
	opened.push(here);
	here.open({ getCwd: () => "/repo", getSessionId: () => id }, undefined);
	if (prompted) here.prompted();
	return { here, sent, notes, shown, held, wentIn, limit, state };
}

function name(here: Here, handle: string): void {
	here.log("session.named", { handle });
}

/** The peer of a session, as the folder holds it. */
function peerOf(here: Here, id: string) {
	return here.live().find((one) => one.session === id);
}

/** Only the colour names matter here. */
const plain = { fg: (_color: string, text: string) => text } as unknown as Theme;

async function settle(...sessions: { here: Here }[]): Promise<void> {
	for (let round = 0; round < 3; round++) {
		// oxlint-disable-next-line no-await-in-loop -- bids resolve over a few ticks
		await new Promise((resolve) => setTimeout(resolve, 0));
		for (const { here } of sessions) here.sync();
	}
}

describe("being here", () => {
	test("a session records its process's start, and a pid running with another start is gone", () => {
		const { here } = session("a", undefined, true, null);
		const repo = { getCwd: () => "/repo" };
		const mine = readFrom(logPath(targetOf({ ...repo, getSessionId: () => "a" })), 0).events;
		expect(mine.find((event) => event.type === "session.started")?.data).toMatchObject({
			pid: process.pid,
			start: ownStart(),
		});
		for (const [id, start] of [
			["twin", ownStart()],
			["ghost", "0"],
		] as const) {
			const target = targetOf({ ...repo, getSessionId: () => id });
			logEvent(target, undefined, "session.started", { pid: process.pid, host: HOST, start });
		}
		here.sync();
		expect(here.live().map((peer) => peer.session)).toEqual(["a", "twin"]);
	});

	test("a title-only line from an older log names nothing, and the handle stays", () => {
		const a = session("a", undefined, true, null);
		a.here.log("session.named", { handle: "otter" });
		a.here.sync();
		a.here.log("session.named", { title: "Fix the release" } as never);
		a.here.sync();
		expect(peerOf(a.here, "a")?.handle).toBe("otter");
		expect(peerOf(a.here, "a")).not.toHaveProperty("title");
	});

	test("each session sees the others, by the name its tasks gave it", () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "migration");
		a.here.sync();
		expect([...a.here.names().bySession.values()].map((named) => named.handle)).toEqual([
			"new-a",
			"migration",
		]);
		b.here.close();
		a.here.sync();
		expect(a.here.live().map((peer) => peer.session)).toEqual(["a"]);
	});
});

describe("who is open, asked on every drawing", () => {
	test("checks the processes once, until the folder changes or a second goes by", () => {
		let checked = 0;
		const { here } = session("a", undefined, true, () => {
			checked++;
			return true;
		});
		const b = session("b");
		here.sync();
		// A new second, so the first of the hundred asks works it out and the rest reuse it.
		now += 1_000;
		checked = 0;
		for (let i = 0; i < 100; i++) {
			here.live();
			here.names();
		}
		expect(checked).toBe(2);
		expect(here.names()).toBe(here.names());

		name(b.here, "migration");
		here.sync();
		checked = 0;
		expect(here.names().bySession.get("b")?.handle).toBe("migration");
		expect(checked).toBeLessThanOrEqual(2);
		const after = checked;

		now += 999 - (now % 1_000);
		here.live();
		expect(checked).toBe(after);
		now += 1;
		here.live();
		expect(checked).toBe(after + 2);
	});

	test("a session that died without a word is gone within a second", () => {
		let open = true;
		const { here } = session("a", undefined, true, (pid) => pid === process.pid && open);
		session("b");
		here.sync();
		expect(here.live()).toHaveLength(2);
		open = false;
		now += 1_000;
		expect(here.live()).toHaveLength(0);
	});
});

describe("a message", () => {
	test("from an agent wakes an idle one, and attaches to a busy one between its calls", () => {
		const a = session("a");
		const b = session("b");
		a.here.post(["b"], "are you in auth.ts?", "agent");
		b.here.sync();
		expect(b.sent).toEqual([
			expect.objectContaining({
				kind: "custom",
				options: { triggerTurn: true, deliverAs: "followUp" },
			}),
		]);
		expect(b.sent[0]?.text).toContain("It is not the operator");

		b.state.idle = false;
		a.here.post(["b"], "and session.ts?", "agent");
		b.here.sync();
		expect(b.sent[1]?.options).toEqual({ triggerTurn: true, deliverAs: "steer" });
		a.here.sync();
		const receipts = [...a.here.folder.messages.values()].map(
			(message) => message.received.get("b")?.mode,
		);
		expect(receipts).toEqual(["woke", "steered"]);
	});

	test("from you arrives as your words right away", () => {
		const a = session("a");
		const b = session("b");
		a.here.post(["b"], "run the tests", "you");
		b.here.sync();
		expect(b.sent).toEqual([
			{ kind: "user", text: "run the tests", options: { deliverAs: "followUp" } },
		]);
	});

	test("a burst arrives as one, so a run reads it all instead of one run per message", () => {
		const a = session("a");
		const b = session("b");
		for (let i = 0; i < 6; i++) a.here.post(["b"], `ping ${i}`, "agent");
		b.here.sync();
		expect(b.sent).toHaveLength(1);
		expect(b.sent[0]?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		for (let i = 0; i < 6; i++) expect(b.sent[0]?.text).toContain(`ping ${i}`);
	});

	/** Two agents answering each other, each reply written in the run the last one woke. */
	function pingPong(replies: number) {
		const a = session("a");
		const b = session("b");
		const sessions = [a, b];
		let writer = 0;
		a.here.post(["b"], "start", "agent");
		for (let reply = 1; reply <= replies; reply++) {
			const reader = sessions[1 - writer];
			reader?.here.sync();
			expect(reader?.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
			writer = 1 - writer;
			reader?.here.post([writer === 0 ? "b" : "a"], `reply ${reply}`, "agent");
		}
		const last = sessions[1 - writer];
		last?.here.sync();
		return { last, other: sessions[writer], to: writer === 0 ? "b" : "a" };
	}

	test("agents that only answer each other stop waking at the chain limit, until someone prompts", () => {
		const { last, other, to } = pingPong(CHAIN_LIMIT);
		expect(last?.sent.at(-1)?.options).toEqual({ deliverAs: "nextTurn" });
		// Shown now, and drawn only once: the held line says why, with the limit that stopped it.
		expect(last?.held.at(-1)).toMatchObject({ why: "quiet", chain: CHAIN_LIMIT });
		expect(last?.sent.at(-1)?.display).toBe(false);

		last?.here.prompted();
		last?.here.post([to], "you prompted, so this wakes", "agent");
		other?.here.sync();
		expect(other?.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
	});

	test("short of the limit, they keep waking each other without asking you", () => {
		const { last } = pingPong(CHAIN_LIMIT - 1);
		expect(last?.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		expect(last?.held).toEqual([]);
	});

	test("a chain limit of 0 never stops them", () => {
		const a = session("a");
		const b = session("b");
		a.limit.chain = 0;
		b.limit.chain = 0;
		let reader = b;
		let writer = a;
		writer.here.post(["b"], "start", "agent");
		for (let reply = 1; reply <= 30; reply++) {
			reader.here.sync();
			expect(reader.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
			[reader, writer] = [writer, reader];
			writer.here.post([reader === a ? "a" : "b"], `reply ${reply}`, "agent");
		}
		expect([...a.held, ...b.held]).toEqual([]);
	});
});

describe("what waits for your next prompt", () => {
	test("goes in with a run a colleague's message starts, and says whose", () => {
		const a = session("a");
		const b = session("b");
		const c = session("c");
		name(c.here, "otter");
		b.limit.chain = 1;
		// a and b answer each other until the chain passes b's limit of 1.
		a.here.post(["b"], "start", "agent");
		b.here.sync();
		b.here.started();
		b.here.post(["a"], "deep", "agent");
		b.here.settled();
		a.here.sync();
		a.limit.chain = 1;
		a.here.started();
		a.here.post(["b"], "too deep", "agent");
		a.here.settled();
		b.here.sync();
		expect(b.held.at(-1)?.why).toBe("quiet");
		expect(b.wentIn).toEqual([]);

		// A message from a chain you started elsewhere wakes b, and the held one rides in with it.
		c.here.post(["b"], "fresh", "agent");
		c.here.sync();
		b.here.sync();
		expect(b.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		b.here.started();
		const held = [...b.here.folder.messages.values()].find((one) => one.text === "too deep");
		expect(b.wentIn).toEqual([{ ids: [held?.id ?? ""], by: "otter" }]);
		// The room learns the agent got it, and the run is as deep as the deepest message in it.
		expect(held?.received.get(b.here.session ?? "")?.mode).toBe("woke");
		b.here.post(["a"], "next", "agent");
		const next = [...b.here.folder.messages.values()].find((one) => one.text === "next");
		// "too deep" was written two replies in, so the run it went in with is the third.
		expect(next?.depth).toBe(3);
	});

	test("your words in a busy run do not make the next run yours", () => {
		const a = session("a");
		const b = session("b");
		b.state.idle = false;
		b.here.started();
		for (let i = 0; i <= STEERS_PER_RUN; i++) {
			a.here.post(["b"], `note ${i}`, "agent");
			b.here.sync();
		}
		expect(b.held.at(-1)?.why).toBe("full");
		// You steer the busy run, which starts no run of its own.
		b.here.prompted();
		b.state.idle = true;
		b.here.settled();
		const c = session("c");
		name(c.here, "otter");
		c.here.post(["b"], "fresh", "agent");
		c.here.sync();
		b.here.sync();
		b.here.started();
		expect(b.wentIn.map((went) => went.by)).toEqual(["otter"]);
	});

	test("your words from another session start a run that is yours", () => {
		const a = session("a");
		const b = session("b", undefined, false);
		a.here.post(["b"], "while you were away", "agent");
		b.here.sync();
		expect(b.held.at(-1)?.why).toBe("asleep");
		a.here.post(["b"], "the operator, from a", "you");
		b.here.sync();
		expect(b.sent.at(-1)?.kind).toBe("user");
		b.here.started();
		expect(b.wentIn).toEqual([]);
	});

	test("a message to the whole room is never held as a loop, but one to this agent is", () => {
		const a = session("a");
		const b = session("b");
		b.limit.chain = 1;
		// a writes from a run one reply deep, at b's limit.
		b.here.post(["a"], "start", "agent");
		a.here.sync();
		a.here.started();
		a.here.post("all", "to everyone", "agent");
		b.here.sync();
		expect(b.held).toEqual([]);
		expect(b.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		// It still counts: the announcement carries a's depth, and the run it woke writes one deeper.
		const messages = () => [...b.here.folder.messages.values()];
		expect(messages().find((one) => one.text === "to everyone")?.depth).toBe(1);
		b.here.started();
		b.here.post(["c"], "after the announcement", "agent");
		expect(messages().find((one) => one.text === "after the announcement")?.depth).toBe(2);
		b.here.settled();
		a.here.post(["b"], "to you", "agent");
		b.here.sync();
		expect(b.held.at(-1)?.why).toBe("quiet");
	});

	test("goes in with your prompt without a word more", () => {
		const a = session("a");
		const b = session("b", undefined, false);
		a.here.post(["b"], "while you were away", "agent");
		b.here.sync();
		expect(b.held.at(-1)?.why).toBe("asleep");
		b.here.prompted();
		b.here.started();
		expect(b.wentIn).toEqual([]);
		// Once taken, a later run has nothing of it to report.
		b.here.settled();
		b.here.started();
		expect(b.wentIn).toEqual([]);
	});

	test("a busy agent that queues for your next prompt by your setting is not held as a loop", () => {
		const a = session("a");
		const b = session("b");
		b.state.idle = false;
		b.limit.busy = "next-turn";
		a.here.post(["b"], "later", "agent");
		b.here.sync();
		expect(b.sent.at(-1)?.options).toEqual({ deliverAs: "nextTurn" });
		expect(b.held).toEqual([]);
	});
});

describe("agents talking while they work", () => {
	test("a message steered into a run you started does not make the chain deeper", () => {
		const a = session("a");
		const b = session("b");
		a.state.idle = false;
		b.state.idle = false;
		// Past a chain limit of 4, so a deeper run would show.
		a.limit.chain = 4;
		b.limit.chain = 4;
		for (let round = 0; round < 6; round++) {
			a.here.post(["b"], `from a ${round}`, "agent");
			b.here.sync();
			b.here.post(["a"], `from b ${round}`, "agent");
			a.here.sync();
		}
		const options = [...a.sent, ...b.sent].map((sent) => sent.options);
		expect(new Set(options.map((one) => JSON.stringify(one)))).toEqual(
			new Set([JSON.stringify({ triggerTurn: true, deliverAs: "steer" })]),
		);
		// Both still write at the depth of the run you started.
		expect([...a.here.folder.messages.values()].every((message) => message.depth === 0)).toBe(true);
	});

	test("a run takes a few messages from agents, and the rest wait for your next prompt", () => {
		const a = session("a");
		const b = session("b");
		b.state.idle = false;
		for (let i = 0; i <= STEERS_PER_RUN; i++) {
			a.here.post(["b"], `note ${i}`, "agent");
			b.here.sync();
		}
		expect(b.sent.slice(0, STEERS_PER_RUN).every((sent) => sent.display !== false)).toBe(true);
		expect(b.sent.at(-1)?.options).toEqual({ deliverAs: "nextTurn" });
		expect(b.held).toEqual([{ from: [`note ${STEERS_PER_RUN}`], why: "full" }]);

		b.here.prompted();
		a.here.post(["b"], "after your prompt", "agent");
		b.here.sync();
		expect(b.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "steer" });
	});
});

describe("a session the operator just opened", () => {
	test("never gets what was sent before it opened", () => {
		const a = session("a");
		a.here.post("all", "before you came", "agent");
		now += 1_000;
		const b = session("b", undefined, false);
		b.here.prompted();
		b.here.sync();
		expect(b.sent).toEqual([]);
	});

	test("is not woken by an agent until the operator writes in it", () => {
		const a = session("a");
		const b = session("b", undefined, false);
		a.here.post("all", "anyone on the migration?", "agent");
		b.here.sync();
		expect(b.sent.map((sent) => sent.options)).toEqual([{ deliverAs: "nextTurn" }]);
		expect(b.held.map((one) => one.why)).toEqual(["asleep"]);

		b.here.prompted();
		a.here.post(["b"], "now you are on", "agent");
		b.here.sync();
		expect(b.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
	});

	test("your message to everyone from another session counts as the first prompt", () => {
		const a = session("a");
		const b = session("b", undefined, false);
		a.here.post("all", "everyone, check the build", "you");
		b.here.sync();
		expect(b.sent[0]?.kind).toBe("user");

		a.here.post(["b"], "and the lint", "agent");
		b.here.sync();
		expect(b.sent.at(-1)?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
	});

	test("a session that listens does not bid on a request to anyone, because bidding is taking part", async () => {
		const a = session("a");
		const b = session("b");
		// The mode is logged in the folder's room, which is where a session says how it stands here.
		b.here.log("room.mode", {
			member: { session: "b", cwd: "/repo" },
			mode: "listening",
		});
		b.here.sync();
		const request = () => [...b.here.folder.messages.values()][0];
		a.here.post("any", "add tests for the callback", "you");
		await settle(a, b);
		expect(request()?.bids.has("b")).toBe(false);
		// What names it still arrives, so listening is not being out.
		a.here.post(["b"], "your call", "you");
		await settle(a, b);
		expect(b.sent.at(-1)?.text).toBe("your call");
	});

	test("does not bid on a request until the operator writes in it, then bids on what is open", async () => {
		const a = session("a");
		const b = session("b", undefined, false);
		a.here.post("any", "add tests for the callback", "agent");
		await settle(a, b);
		const request = () => [...b.here.folder.messages.values()][0];
		expect(request()?.bids.has("b")).toBe(false);

		b.here.prompted();
		await settle(a, b);
		expect(request()?.bids.has("b")).toBe(true);
	});
});

describe("a request to anyone", () => {
	test("every session bids, and only the one all agree on takes it", async () => {
		const a = session("a", { fit: 0.2, reason: "on docs" });
		const b = session("b", { fit: 0.9, reason: "already in auth.ts" });
		const c = session("c", { fit: 0.6, reason: "near it" });
		a.here.post("any", "switch the login to OAuth", "you");
		await settle(a, b, c);
		const request = [...a.here.folder.messages.values()][0];
		expect(request?.takenBy).toBe("b");
		expect(b.sent).toEqual([
			{ kind: "user", text: "switch the login to OAuth", options: { deliverAs: "followUp" } },
		]);
		expect(a.sent).toEqual([]);
		expect(c.sent).toEqual([]);
	});

	test("the sessions that did not take it show it in their transcript, saying who took it", async () => {
		const a = session("a", { fit: 0.2, reason: "" });
		const b = session("b", { fit: 0.9, reason: "" });
		const c = session("c", { fit: 0.6, reason: "" });
		a.here.post("any", "switch the login to OAuth", "agent");
		await settle(a, b, c);
		const taker = b.here.names().bySession.get("b")?.handle;
		expect(c.shown.map((one) => [one.text, one.takenBy])).toEqual([
			["switch the login to OAuth", taker],
		]);
		// The one that took it gets the request itself, and the writer has its own tool row.
		expect(b.shown).toEqual([]);
		expect(a.shown).toEqual([]);
	});

	test("with everyone busy it waits, and the first to finish takes it", async () => {
		const a = session("a", { fit: 0.9, reason: "" });
		const b = session("b", { fit: 0.3, reason: "" });
		a.here.started();
		b.here.started();
		a.here.post("any", "write the changelog", "you");
		await settle(a, b);
		now += BID_WINDOW_MS;
		await settle(a, b);
		expect([...a.here.folder.messages.values()][0]?.takenBy).toBeUndefined();
		b.here.settled();
		await settle(a, b);
		expect([...a.here.folder.messages.values()][0]?.takenBy).toBe("b");
		expect(b.sent.map((sent) => sent.text)).toEqual(["write the changelog"]);
	});

	test("a bid that comes after the window, from a busy agent, takes it once that agent is idle", async () => {
		const a = session("a", { fit: 1, reason: "" });
		const b = session("b", { fit: 0.1, reason: "" });
		b.here.started();
		a.here.post("any", "the room uses the new frames", "agent");
		now += BID_WINDOW_MS + 3_000;
		await settle(a, b);
		expect([...b.here.folder.messages.values()][0]?.takenBy).toBeUndefined();
		now += 26_000;
		b.here.settled();
		await settle(a, b);
		expect([...b.here.folder.messages.values()][0]?.takenBy).toBe("b");
	});

	test("two requests taken at once arrive together, the older first", async () => {
		const a = session("a", { fit: 1, reason: "" });
		const b = session("b", { fit: 0.4, reason: "" });
		b.here.started();
		a.here.post("any", "first, the room", "agent");
		now += 1_000;
		a.here.post("any", "second, the board", "agent");
		now += BID_WINDOW_MS;
		await settle(a, b);
		b.here.settled();
		await settle(a, b);
		expect(b.sent).toHaveLength(1);
		const text = b.sent[0]?.text ?? "";
		expect(text.indexOf("first, the room")).toBeLessThan(text.indexOf("second, the board"));
	});

	test("what arrived while a session reloaded still wakes it", async () => {
		const a = session("a");
		const b = session("b");
		b.here.close();
		a.here.post(["b"], "the room is in", "agent");
		now += 5_000;
		b.here.open({ getCwd: () => "/repo", getSessionId: () => "b" }, undefined);
		await settle(a, b);
		expect(b.sent.map((sent) => sent.options)).toEqual([
			{ triggerTurn: true, deliverAs: "followUp" },
		]);
	});

	test("an agent handing work to anyone does not bid on it, and the taker hears it is from a peer", async () => {
		const a = session("a", { fit: 1, reason: "" });
		const b = session("b", { fit: 0.4, reason: "" });
		name(a.here, "oauth");
		a.here.post("any", "add tests for the callback", "agent");
		now += BID_WINDOW_MS;
		await settle(a, b);
		expect([...b.here.folder.messages.values()][0]?.takenBy).toBe("b");
		expect(b.sent[0]?.text).toContain("Message from oauth");
		expect(b.sent[0]?.text).toContain("you took it");
	});
});

describe("what the footer shows", () => {
	test("a mark per other agent, and a count of what waits for an answer", async () => {
		const a = session("a");
		const b = session("b");
		name(a.here, "migration");
		name(b.here, "oauth");
		const id = b.here.post(["a"], "are you in auth.ts?", "agent");
		await settle(a, b);

		const summary = a.here.summary();
		expect(summary.others.map((one) => [one.handle, one.state])).toEqual([["oauth", "idle"]]);
		expect(summary.unread).toBe(1);
		expect(statusLine(summary, plain)).toBe("\u25c7 @1");

		a.here.read(id);
		expect(a.here.summary().unread).toBe(0);
		expect(statusLine(a.here.summary(), plain)).toBe("\u25c7");
	});

	test("what was said before this session opened is not counted", async () => {
		const b = session("b");
		name(b.here, "oauth");
		b.here.post("all", "the release is out", "agent");
		now += 60_000;
		const a = session("a");
		name(a.here, "migration");
		await settle(a, b);
		expect(a.here.summary().unread).toBe(0);

		b.here.post("all", "and the docs too", "agent");
		await settle(a, b);
		expect(a.here.summary().unread).toBe(1);
	});

	test("a request to anyone is not on the footer, and neither is your own message", async () => {
		const a = session("a");
		const b = session("b");
		name(a.here, "migration");
		name(b.here, "oauth");
		b.here.post("any", "who wants the tests?", "agent");
		b.here.post(["a"], "and you?", "you");
		await settle(a, b);
		expect(a.here.summary().unread).toBe(0);
	});

	test("an agent working shows a filled mark, one waiting on you a flag", async () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "oauth");
		b.here.started();
		a.here.sync();
		expect(statusLine(a.here.summary(), plain)).toBe("\u25c6");
	});
});

describe("who else is here", () => {
	test("a colleague arriving is told to the agent, and never starts a run", () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "oauth");
		a.here.sync();

		expect(a.notes).toHaveLength(1);
		expect(a.notes[0]?.text).toContain("oauth is working in this folder.");
		expect(a.notes[0]?.text).toContain("Use the peers tool");
		expect(a.notes[0]?.options).toEqual({ deliverAs: "nextTurn" });
		expect(a.notes[0]?.display).toBe(false);

		// Said once, not on every read of the folder.
		a.here.sync();
		expect(a.notes).toHaveLength(1);

		b.here.close();
		a.here.sync();
		expect(a.notes.at(-1)?.text).toContain("oauth left this folder");
	});

	test("the agent is told what the new colleague is doing and what waits on the operator", () => {
		const a = session("a");
		const b = session("b");
		name(b.here, "migration");
		b.here.log("board.changed", {
			view: {
				open: [
					{ id: "c1", title: "Move the users table", column: "doing", at: now },
					{
						id: "c2",
						title: "Drop the old table",
						column: "todo",
						at: now,
						blocked: { on: "operator", why: "keep a backup?" },
					},
				],
				backlog: 0,
				done: [],
			},
		});
		b.here.log("activity", { kind: "edited", path: "src/db.ts" });
		a.here.sync();

		expect(a.notes[0]?.text).toContain("doing: Move the users table");
		expect(a.notes[0]?.text).toContain("waiting: Drop the old table");
		expect(a.notes[0]?.text).toContain("edited: src/db.ts");
	});

	test("a session that opens and leaves without doing anything is never mentioned", () => {
		const a = session("a");
		const b = session("b");
		a.here.sync();
		expect(a.notes).toHaveLength(0);

		b.here.close();
		a.here.sync();
		expect(a.notes).toHaveLength(0);
	});

	test("a session with nothing to show is mentioned once it has been here a moment", () => {
		const a = session("a");
		const b = session("b");
		a.here.sync();
		expect(a.notes).toHaveLength(0);

		now += 5_000;
		b.here.log("session.state", { state: "idle" });
		a.here.sync();
		expect(a.notes).toHaveLength(1);
		expect(a.notes[0]?.text).toContain("is working in this folder");
	});
});

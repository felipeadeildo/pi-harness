import { describe, expect, test } from "bun:test";
// A client against a fake daemon: the cursor it sends in its hello, the cache it draws before the
// network answers, the reconnect after a drop, and the snapshot it asks for when it lost a number.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Entry, Envelope } from "@adeildo/pi-remote-protocol";
import { applyLogged, emptyHarnessState } from "@adeildo/pi-remote-protocol";

import { memoryCache } from "../src/cache.ts";
import { connect } from "../src/connection.ts";
import { Outbox } from "../src/outbox.ts";
import { harnessOf, transcriptOfSession } from "../src/session.ts";

const FIXTURE = join(
	import.meta.dir,
	"..",
	"..",
	"remote-protocol",
	"test",
	"fixtures",
	"recording",
);
const key = { machine: "here", session: "01a16b15" };

function lines(name: string): Record<string, unknown>[] {
	return readFileSync(join(FIXTURE, name), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

const entries = lines("session.jsonl").filter(
	(entry) => entry.type !== "session",
) as unknown as Entry[];
const facts = lines("harness.jsonl") as { type: string; data: unknown }[];

/** The recording's facts folded once, which is what a cache holds now. */
const folded = (list: { type: string; data: unknown }[]) =>
	list.reduce((state, fact) => applyLogged(state, fact.type, fact.data), emptyHarnessState());

/** The envelopes the bridge sends after a snapshot: the log's facts, then the entries, numbered. */
function stream(first: number): Envelope[] {
	let seq = first;
	const one = (type: string, data: unknown): Envelope => {
		seq += 1;
		return {
			v: 1,
			kind: "event",
			machine: key.machine,
			session: key.session,
			epoch: "e1",
			seq,
			type,
			data,
			at: 0,
		};
	};
	return [
		...facts
			.filter((fact) => fact.type !== "session.named")
			.map((fact) => one(fact.type, fact.data)),
		...entries.map((entry) => one("entry", entry)),
	];
}

const snapshot: Envelope = {
	v: 1,
	kind: "event",
	machine: key.machine,
	session: key.session,
	epoch: "e1",
	seq: 1,
	type: "snapshot",
	data: {
		snapshot: { session: key.session, machine: key.machine, cwd: "/work", kind: "terminal" },
		entries: [],
		harness: emptyHarnessState(),
	},
	at: 0,
};

/** The cursor a hello carries, which is what the daemon resumes from. */
function cursorOf(envelope: Envelope): { epoch?: string; seq?: number } {
	return (envelope.data as { cursor?: { epoch?: string; seq?: number } }).cursor ?? {};
}

describe("a client of a session", () => {
	test("a command that waited past the window goes out when the person sends it now", async () => {
		let clock = 0;
		const outbox = new Outbox({ now: () => clock });
		const sent: Envelope[] = [];
		const client = connect({
			key,
			cache: memoryCache(),
			outbox,
			open: () => ({ send: (envelope) => sent.push(envelope), close: () => {} }),
		});
		// Typed while the daemon was away, three minutes before it answered again.
		const command = outbox.add("prompt.send", { text: "push it" });
		clock = 3 * 60_000;
		await client.load();
		// Past the window it waits for the person, and asking for it is what puts it on the wire: the
		// queue alone cannot, which is the reason "Send now" did nothing.
		expect(sent.filter((envelope) => envelope.kind === "command")).toEqual([]);
		expect(client.release(command.id)).toBe(true);
		expect(sent.filter((envelope) => envelope.kind === "command").map((one) => one.id)).toEqual([
			command.id,
		]);
		expect(outbox.all()[0]?.state).toBe("sent");
		client.stop();
	});

	test("the hello carries the cursor, and what follows is read from it", async () => {
		let hello: Envelope | undefined;
		const client = connect({
			key,
			cache: memoryCache(),
			open: (onMessage) => ({
				send: (sent) => {
					hello = sent;
					// The daemon answers a client that lost its place with a snapshot, then streams.
					for (const envelope of [snapshot, ...stream(1)]) onMessage(envelope);
				},
				close: () => {},
			}),
		});

		await client.load();

		expect(hello).toBeDefined();
		expect(cursorOf(hello as Envelope)).toEqual({});
		// The entries and the task facts of the recording arrived, each once, in pi's order.
		expect(client.session().entries.map((entry) => entry.id)).toEqual(
			entries.map((entry) => entry.id),
		);
		expect(client.session().harness.tasks?.handle).toBe("rig");
		expect(transcriptOfSession(client.session()).items.length).toBeGreaterThan(0);
		client.stop();
	});

	test("a snapshot alone is enough: the state arrives folded, not as facts to fold", async () => {
		// The restart case, and the reason the wire changed: the client opens and the daemon answers
		// with one message carrying the state the bridge held. Nothing follows it — if the client only
		// read a list of facts, this session would draw with no tasks, no mode and no question.
		let hello: Envelope | undefined;
		const client = connect({
			key,
			cache: memoryCache(),
			open: (onMessage) => ({
				send: (sent) => {
					hello = sent;
					onMessage({
						...snapshot,
						data: {
							...(snapshot.data as Record<string, unknown>),
							harness: {
								tasks: { version: 1, handle: "rig", tasks: [], decisions: [] },
								mode: "judge",
								asks: {
									q1: {
										id: "q1",
										source: "permission",
										questions: [{ header: "Deploy", question: "Ship it", options: [] }],
									},
								},
								rulings: {},
							},
						},
					});
				},
				close: () => {},
			}),
		});

		await client.load();

		expect(hello).toBeDefined();
		expect(client.session().harness.tasks?.handle).toBe("rig");
		expect(client.session().harness.mode).toBe("judge");
		expect(Object.keys(client.session().harness.asks)).toEqual(["q1"]);
		client.stop();
	});

	test("a warm cache draws before a single byte goes out, and hello resumes from it", async () => {
		const cache = memoryCache();
		await cache.write({
			key,
			cursor: { epoch: "e1", seq: 1, entry: entries.at(-1)?.id },
			entries,
			harness: folded(facts),
		});
		const order: string[] = [];
		let drawn: number[] = [];

		const client = connect({
			key,
			cache,
			open: () => ({
				send: () => order.push("hello"),
				close: () => {},
			}),
		});
		client.on((session) => {
			drawn.push(transcriptOfSession(session).items.length);
			order.push("drawn");
		});

		await client.load();

		expect(order[0]).toBe("drawn");
		expect(order).toContain("hello");
		expect(drawn[0]).toBeGreaterThan(0);
		drawn = [];
		client.stop();
	});

	test("a drop reconnects with the cursor of the last envelope it read", async () => {
		const envelopes = [snapshot, ...stream(1)];
		const hellos: Envelope[] = [];
		let attempts = 0;

		const client = connect({
			key,
			cache: memoryCache(),
			open: (onMessage, onClose) => {
				attempts += 1;
				const attempt = attempts;
				return {
					send: (hello) => {
						hellos.push(hello);
						const from = cursorOf(hello).seq ?? 0;
						const rest = envelopes.filter((envelope) => (envelope.seq ?? 0) > from);
						// The first attempt gets three envelopes and loses the link; the second one
						// gets the rest, because the hello resumes where the first stopped.
						const take = attempt === 1 ? rest.slice(0, 3) : rest;
						queueMicrotask(() => {
							for (const envelope of take) onMessage(envelope);
							if (attempt === 1) onClose();
						});
					},
					close: () => {},
				};
			},
			wait: (_ms, run) => {
				queueMicrotask(run);
				return () => {};
			},
		});

		await client.load();
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(attempts).toBeGreaterThan(1);
		expect(cursorOf(hellos.at(-1) as Envelope).seq).toBeGreaterThanOrEqual(3);
		// Nothing arrived twice: the entries the client holds are the recording's, in order.
		expect(client.session().entries.map((entry) => entry.id)).toEqual(
			entries.map((entry) => entry.id),
		);
		client.stop();
	});

	test("a duplicate is skipped, so a daemon may send an envelope twice", async () => {
		const envelopes = [snapshot, ...stream(1)];
		let asked = 0;

		const cache = memoryCache();
		await cache.write({
			key,
			cursor: { epoch: "e1", seq: 1 },
			entries: [],
			harness: emptyHarnessState(),
		});

		const client = connect({
			key,
			cache,
			open: (onMessage) => ({
				send: (hello) => {
					if (cursorOf(hello).seq === undefined) asked += 1;
					queueMicrotask(() => {
						// The same envelope twice, and then the next one: only the next one is read,
						// and nothing asks for a snapshot.
						const first = envelopes.find((envelope) => envelope.seq === 2) as Envelope;
						onMessage(first);
						onMessage(first);
						onMessage(envelopes.find((envelope) => envelope.seq === 3) as Envelope);
					});
				},
				close: () => {},
			}),
		});

		await client.load();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(asked).toBe(0);
		expect(client.session().cursor.seq).toBe(3);
		// Read once each: the harness holds exactly what folding those two gives, and the duplicate
		// left no second copy behind.
		const read = stream(1).filter((envelope) => envelope.seq === 2 || envelope.seq === 3);
		expect(client.session().harness).toEqual(
			read.reduce((state, one) => applyLogged(state, one.type, one.data), emptyHarnessState()),
		);
		client.stop();
	});

	test("a delta with no number between two numbered events asks for nothing and moves no cursor", async () => {
		const cache = memoryCache();
		await cache.write({
			key,
			cursor: { epoch: "e1", seq: 1 },
			entries: [],
			harness: emptyHarnessState(),
		});
		const hellos: Envelope[] = [];
		const { seq: _seq, ...unnumbered } = snapshot;

		const client = connect({
			key,
			cache,
			open: (onMessage) => ({
				send: (hello) => {
					hellos.push(hello);
					if (hellos.length > 1) return;
					// The bridge numbers what a replay can give back, and a delta only matters live.
					onMessage({ ...snapshot, seq: 2, type: "mode.changed", data: { mode: "edits" } });
					onMessage({ ...unnumbered, type: "pi.message_update", data: { delta: "Hel" } });
					onMessage({ ...snapshot, seq: 3, type: "mode.changed", data: { mode: "manual" } });
				},
				close: () => {},
			}),
			wait: () => () => {},
		});

		await client.load();

		expect(hellos).toHaveLength(1);
		expect(client.session().cursor).toMatchObject({ epoch: "e1", seq: 3 });
		expect(harnessOf(client.session()).mode).toBe("manual");
		client.stop();
	});

	test("a hole in the numbering asks for a snapshot instead of drawing what comes next", async () => {
		const cache = memoryCache();
		await cache.write({
			key,
			cursor: { epoch: "e1", seq: 1 },
			entries: [],
			harness: emptyHarnessState(),
		});
		const hellos: Envelope[] = [];

		const client = connect({
			key,
			cache,
			open: (onMessage) => ({
				send: (hello) => {
					hellos.push(hello);
					if (hellos.length > 1) return;
					// Two when one was expected, and then five: the client missed three numbers.
					onMessage({ ...snapshot, seq: 2, type: "mode.changed", data: { mode: "edits" } });
					onMessage({ ...snapshot, seq: 5, type: "mode.changed", data: { mode: "manual" } });
				},
				close: () => {},
			}),
			wait: () => () => {},
		});

		await client.load();

		expect(hellos.length).toBeGreaterThan(1);
		expect(cursorOf(hellos.at(-1) as Envelope).seq).toBeUndefined();
		// What it read before the hole stands; what came after it was not drawn.
		expect(harnessOf(client.session()).mode).toBe("edits");
		client.stop();
	});
});

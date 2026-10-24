// A command typed while the daemon was away. The queue is the outbox's job; this is the seam: when it
// goes out, and what a reply does to it.
import { describe, expect, test } from "bun:test";

import type { Envelope } from "@adeildo/pi-remote-protocol";

import { memoryCache } from "../src/cache.ts";
import { connect } from "../src/connection.ts";
import { Outbox } from "../src/outbox.ts";

const key = { machine: "here", session: "s" };

/** A transport the test drives: what it sent, when to answer, and when to drop. */
function socket() {
	const sent: Envelope[] = [];
	let arrive: ((envelope: unknown) => void) | undefined;
	let drop: (() => void) | undefined;
	let opened = 0;
	return {
		sent,
		opened: () => opened,
		arrive: (envelope: unknown) => arrive?.(envelope),
		drop: () => drop?.(),
		open: (onMessage: (envelope: unknown) => void, onClose: () => void) => {
			opened += 1;
			arrive = onMessage;
			drop = onClose;
			return {
				send: (envelope: Envelope) => void sent.push(envelope),
				close: () => {},
			};
		},
	};
}

const client = (wire: ReturnType<typeof socket>) =>
	connect({
		key,
		cache: memoryCache(),
		open: wire.open,
		wait: (_ms, run) => {
			queueMicrotask(run);
			return () => {};
		},
	});

describe("a command on its way out", () => {
	test("it goes out once, with the id its reply will carry", async () => {
		const wire = socket();
		const session = client(wire);
		await session.load();
		const command = session.send("run.abort", {});

		const out = wire.sent.filter((one) => one.kind === "command");
		expect(out).toHaveLength(1);
		expect(out[0]?.id).toBe(command.id);
		expect(out[0]?.type).toBe("run.abort");
		expect(session.outbox().all()[0]?.state).toBe("sent");
		session.stop();
	});

	test("the command says who sent it, so the answer can name where it came from", async () => {
		const wire = socket();
		const session = connect({
			key,
			cache: memoryCache(),
			open: wire.open,
			by: { kind: "client", name: "phone-7", machine: "here" },
			wait: (_ms, run) => {
				queueMicrotask(run);
				return () => {};
			},
		});
		await session.load();
		session.send("run.abort", {});
		const sent = wire.sent.find((one) => one.kind === "command");
		// The whole identity, not just its kind: a name rewritten on the way would pass otherwise.
		expect(sent?.by).toEqual({ kind: "client", name: "phone-7", machine: "here" });
		session.stop();
	});

	test("a connection with no identity sends no author, instead of a generic one", async () => {
		const wire = socket();
		const session = client(wire);
		await session.load();
		session.send("run.abort", {});

		const sent = wire.sent.find((one) => one.kind === "command");
		expect(sent === undefined ? false : "by" in sent).toBe(false);
		session.stop();
	});

	test("a reply ends it, and an error keeps it with the reason", async () => {
		const wire = socket();
		const session = client(wire);
		await session.load();
		const first = session.send("run.abort", {});
		wire.arrive({ v: 1, kind: "reply", id: first.id, type: "reply", data: {}, at: 0 });
		expect(session.outbox().all()).toEqual([]);

		const second = session.send("mode.set", { mode: "full" });
		wire.arrive({
			v: 1,
			kind: "error",
			id: second.id,
			type: "error",
			data: { reason: "a client cannot ask for the full mode" },
			at: 0,
		});
		expect(session.outbox().all()[0]?.why).toContain("full mode");
		session.stop();
	});

	test("sent with the socket gone, it stays waiting instead of pretending it left", async () => {
		const wire = socket();
		// No reconnect scheduled: this is the client with the daemon out of reach.
		const session = connect({
			key,
			cache: memoryCache(),
			open: wire.open,
			wait: () => () => {},
		});
		await session.load();
		wire.drop();

		const command = session.send("run.abort", {});
		// Nothing went out, so nothing is marked sent: it is still in the queue the screen draws.
		expect(session.outbox().all()[0]?.state).toBe("waiting");
		expect(
			session
				.outbox()
				.ready()
				.map((one) => one.id),
		).toEqual([command.id]);
		session.stop();
	});

	test("a reply without an id never reaches the session, so it moves no cursor", async () => {
		const wire = socket();
		const session = client(wire);
		await session.load();
		const before = { ...session.session().cursor };

		wire.arrive({ v: 1, kind: "reply", type: "reply", data: {}, at: 0 });
		wire.arrive({ v: 1, kind: "error", type: "error", data: { reason: "no id" }, at: 0 });

		expect(session.session().cursor).toEqual(before);
		session.stop();
	});

	test("an answer without an id settles the one command in flight, instead of leaving it sent", async () => {
		const wire = socket();
		const session = client(wire);
		await session.load();
		const command = session.send("run.abort", {});
		wire.arrive({ v: 1, kind: "reply", type: "reply", data: {}, at: 0 });

		const [kept] = session.outbox().all();
		expect(kept?.id).toBe(command.id);
		expect(kept?.state).toBe("refused");
		expect(kept?.why).toContain("without an id");
		session.stop();
	});

	test("sent into a connection that dies, it goes out again on the next one", async () => {
		const wire = socket();
		const session = client(wire);
		await session.load();
		const command = session.send("run.abort", {});
		expect(wire.sent.filter((one) => one.kind === "command")).toHaveLength(1);

		wire.drop();
		await new Promise((resolve) => setTimeout(resolve, 20));
		const again = wire.sent.filter((one) => one.kind === "command");
		expect(again).toHaveLength(2);
		// The same id both times, so the far side reads the second as a repeat.
		expect(again[1]?.id).toBe(command.id);
		session.stop();
	});

	test("typed offline, it waits and goes out on the next connection", async () => {
		const wire = socket();
		const outbox = new Outbox({ now: () => 0 });
		const session = connect({
			key,
			cache: memoryCache(),
			open: wire.open,
			outbox,
			wait: (_ms, run) => {
				queueMicrotask(run);
				return () => {};
			},
		});
		await session.load();
		wire.drop();
		// The command is typed with the socket gone, so the queue holds it instead of losing it.
		outbox.add("prompt.send", { text: "keep going" });
		await new Promise((resolve) => setTimeout(resolve, 20));

		const commands = wire.sent.filter((one) => one.kind === "command");
		expect(commands).toHaveLength(1);
		expect(commands[0]?.type).toBe("prompt.send");
		session.stop();
	});
});

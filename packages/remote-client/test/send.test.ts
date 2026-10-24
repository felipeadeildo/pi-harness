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

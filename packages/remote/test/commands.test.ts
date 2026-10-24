// The commands a client sends: each one runs once, is answered on its id, and a resent id is a repeat
// even after a restart, because the ids come back from the session's log.
import { describe, expect, test } from "bun:test";

import type { By } from "@adeildo/pi-kit";
import { envelope, type Envelope } from "@adeildo/pi-remote-protocol";

import { Commands, KEPT_COMMANDS } from "../src/bridge/commands.ts";

const PHONE: By = { kind: "client", name: "phone", machine: "laptop" };

interface Ran {
	kind: "reply" | "error";
	type: string;
	data: Record<string, unknown>;
	id: string;
}

/** A bridge's side of the commands, with the session's effects recorded instead of performed. */
function commands(
	options: { history?: string[]; effects?: Partial<Record<string, () => void>> } = {},
) {
	const answers: Ran[] = [];
	const log: string[] = [];
	const done: string[] = [];
	const effects = {
		abort: () => done.push("abort"),
		compact: (instructions: string | undefined) =>
			done.push(instructions === undefined ? "compact" : `compact:${instructions}`),
		rename: (name: string) => done.push(`rename:${name}`),
		stop: (force: boolean) => done.push(force ? "stop:force" : "stop"),
		...options.effects,
	};
	const instance = new Commands({
		session: "s1",
		effects: {
			abort: () => effects.abort(),
			compact: (instructions) => effects.compact(instructions),
			rename: (name) => effects.rename(name),
			stop: (force) => effects.stop(force),
		},
		history: options.history,
		answer: (kind, type, data, id) => answers.push({ kind, type, data, id }),
		received: (id, command) => log.push(`received ${id} ${command}`),
		outcome: (id, command, _by, outcome) => log.push(`${outcome} ${id} ${command}`),
	});
	return { instance, answers, log, done };
}

function command(type: string, data: unknown = {}, id = "c1"): Envelope {
	return envelope("command", type, data, {
		machine: "here",
		session: "s1",
		epoch: "e1",
		id,
		by: PHONE,
	});
}

describe("a command from a client", () => {
	test("runs and is answered on the id the client sent", () => {
		const { instance, answers, done } = commands();
		instance.run(command("run.abort"));
		expect(done).toEqual(["abort"]);
		expect(answers).toEqual([{ kind: "reply", type: "run.abort", data: {}, id: "c1" }]);
	});

	test("compacts with the instructions it was given, and without them", () => {
		const { instance, done } = commands();
		instance.run(command("session.compact", { instructions: "keep the decisions" }, "c1"));
		instance.run(command("session.compact", {}, "c2"));
		expect(done).toEqual(["compact:keep the decisions", "compact"]);
	});

	test("renames the session, and stops it as asked", () => {
		const { instance, done } = commands();
		instance.run(command("session.rename", { name: "release check" }, "c1"));
		instance.run(command("session.stop", {}, "c2"));
		instance.run(command("session.stop", { force: true }, "c3"));
		expect(done).toEqual(["rename:release check", "stop", "stop:force"]);
	});

	test("logs the id before it runs, and the outcome only when it did not run", () => {
		const { instance, log } = commands();
		instance.run(command("run.abort", {}, "c1"));
		instance.run(command("prompt.send", { text: "hello" }, "c2"));
		expect(log).toEqual([
			"received c1 run.abort",
			"received c2 prompt.send",
			"refused c2 prompt.send",
		]);
	});

	test("a repeat in the same run is answered as one and does nothing twice", () => {
		const { instance, answers, done } = commands();
		instance.run(command("session.compact", {}, "c1"));
		instance.run(command("session.compact", {}, "c1"));
		expect(done).toEqual(["compact"]);
		expect(answers.at(-1)).toEqual({
			kind: "reply",
			type: "session.compact",
			data: { repeat: true },
			id: "c1",
		});
	});

	test("a repeat after a restart is a repeat, because the id came back from the log", () => {
		const { instance, answers, done } = commands({ history: ["c1"] });
		instance.run(command("session.compact", {}, "c1"));
		expect(done).toEqual([]);
		expect(answers[0]?.data).toEqual({ repeat: true });
	});

	test("a command this slice does not serve yet is refused with a reason, not run quietly", () => {
		const { instance, answers, done } = commands();
		instance.run(command("queue.clear", {}, "c1"));
		expect(done).toEqual([]);
		expect(answers[0]).toEqual({
			kind: "error",
			type: "queue.clear",
			data: { reason: "queue.clear is not served by this session yet" },
			id: "c1",
		});
	});

	test("a command of a type nothing knows is refused before it is remembered", () => {
		const { instance, answers, log } = commands();
		instance.run(command("session.explode", {}, "c1"));
		expect(answers[0]).toMatchObject({ kind: "error", id: "c1" });
		expect(log).toEqual(["refused c1 session.explode"]);
	});

	test("a command missing a field it needs is refused, and a valid one after it still runs", () => {
		const { instance, answers, done } = commands();
		instance.run(command("session.rename", {}, "c1"));
		instance.run(command("session.rename", { name: "named" }, "c2"));
		expect(answers[0]?.kind).toBe("error");
		expect(done).toEqual(["rename:named"]);
	});

	test("an effect that throws is answered as an error and logged as failed", () => {
		const { instance, answers, log } = commands({
			effects: {
				abort: () => {
					throw new Error("the run was already over");
				},
			},
		});
		instance.run(command("run.abort", {}, "c1"));
		expect(answers[0]).toEqual({
			kind: "error",
			type: "run.abort",
			data: { reason: "the run was already over" },
			id: "c1",
		});
		expect(log).toEqual(["received c1 run.abort", "failed c1 run.abort"]);
	});

	test("a command with no id is not run: nothing could answer it or call it a repeat", () => {
		const { instance, done, answers } = commands();
		instance.run(envelope("command", "run.abort", {}, { machine: "here", session: "s1" }));
		expect(done).toEqual([]);
		expect(answers).toEqual([]);
	});

	test("remembers the last thousand ids, and forgets the oldest", () => {
		const { instance } = commands();
		for (let at = 0; at < KEPT_COMMANDS + 5; at += 1)
			instance.run(command("run.abort", {}, `c${at}`));
		expect(instance.ran("c0")).toBe(false);
		expect(instance.ran(`c${KEPT_COMMANDS + 4}`)).toBe(true);
	});
});

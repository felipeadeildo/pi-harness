// The commands a client sends: each one runs once, is answered on its id, and a resent id is a repeat
// even after a restart, because the ids come back from the session's log.
import { describe, expect, test } from "bun:test";

import type { By, Letter } from "@adeildo/pi-kit";
import { envelope, type Envelope } from "@adeildo/pi-remote-protocol";

import { type CommandEffects, Commands, KEPT_COMMANDS, Refused } from "../src/bridge/commands.ts";

const PHONE: By = { kind: "client", name: "phone", machine: "laptop" };

interface Ran {
	kind: "reply" | "error";
	type: string;
	data: Record<string, unknown>;
	id: string;
}

/** A bridge's side of the commands, with the session's effects recorded instead of performed. */
function commands(options: { history?: string[]; effects?: Partial<CommandEffects> } = {}) {
	const answers: Ran[] = [];
	const log: string[] = [];
	const done: string[] = [];
	const effects = {
		abort: () => done.push("abort"),
		compact: (instructions: string | undefined) =>
			done.push(instructions === undefined ? "compact" : `compact:${instructions}`),
		rename: (name: string) => done.push(`rename:${name}`),
		stop: (force: boolean) => done.push(force ? "stop:force" : "stop"),
		setModel: async (provider: string, id: string) => {
			done.push(`model:${provider}/${id}`);
		},
		setThinking: (level: string) => done.push(`thinking:${level}`),
		setMode: (mode: string, by: By | undefined) => done.push(`mode:${mode}:${by?.name ?? ""}`),
		answerAsk: (fields: Record<string, unknown>, _by: By | undefined) =>
			done.push(`ask:${String(fields.ask)}`),
		prompt: (id: string, _by: By | undefined, text: string, deliverAs: string) =>
			done.push(`prompt:${id}:${deliverAs}:${text}`),
		clearQueue: () => [] as Letter[],
		...options.effects,
	};
	const instance = new Commands({
		session: "s1",
		effects: {
			abort: () => effects.abort(),
			compact: (instructions) => effects.compact(instructions),
			rename: (name) => effects.rename(name),
			stop: (force) => effects.stop(force),
			setModel: (provider, id) => effects.setModel(provider, id),
			setThinking: (level) => effects.setThinking(level),
			answerAsk: (fields, by) => effects.answerAsk(fields, by),
			setMode: (mode, by) => effects.setMode(mode, by),
			prompt: (id, by, text, deliverAs) => effects.prompt(id, by, text, deliverAs),
			clearQueue: () => effects.clearQueue(),
		},
		history: options.history,
		answer: (kind, type, data, id) => answers.push({ kind, type, data, id }),
		received: (id, type) => log.push(`received ${id} ${type}`),
		outcome: (id, type, _by, outcome) => log.push(`${outcome} ${id} ${type}`),
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
	test("runs and is answered on the id the client sent", async () => {
		const { instance, answers, done } = commands();
		await instance.run(command("run.abort"));
		expect(done).toEqual(["abort"]);
		expect(answers).toEqual([{ kind: "reply", type: "run.abort", data: {}, id: "c1" }]);
	});

	test("compacts with the instructions it was given, and without them", async () => {
		const { instance, done } = commands();
		await instance.run(command("session.compact", { instructions: "keep the decisions" }, "c1"));
		await instance.run(command("session.compact", {}, "c2"));
		expect(done).toEqual(["compact:keep the decisions", "compact"]);
	});

	test("renames the session, and hands the stop's flag to the session, which decides it", async () => {
		const { instance, done } = commands();
		await instance.run(command("session.rename", { name: "release check" }, "c1"));
		await instance.run(command("session.stop", {}, "c2"));
		await instance.run(command("session.stop", { force: true }, "c3"));
		expect(done).toEqual(["rename:release check", "stop", "stop:force"]);
	});

	test("sets the model and the thinking level, in the order the client sent them", async () => {
		const { instance, answers, done } = commands();
		const first = instance.run(command("model.set", { provider: "rig", id: "scripted" }, "c1"));
		const second = instance.run(command("thinking.set", { level: "high" }, "c2"));
		await Promise.all([first, second]);
		expect(done).toEqual(["model:rig/scripted", "thinking:high"]);
		expect(answers.map((one) => one.id)).toEqual(["c1", "c2"]);
	});

	test("a model the session cannot switch to is answered as a failure, not a success", async () => {
		const { instance, answers, log } = commands({
			effects: {
				setModel: () => Promise.reject(new Error("no model rig/none on this machine")),
			},
		});
		await instance.run(command("model.set", { provider: "rig", id: "none" }, "c1"));
		expect(answers[0]).toEqual({
			kind: "error",
			type: "model.set",
			data: { reason: "no model rig/none on this machine" },
			id: "c1",
		});
		expect(log).toEqual(["received c1 model.set", "failed c1 model.set"]);
	});

	test("answers only after the effect is done, so a reply is news and not a promise", async () => {
		let finish: () => void = () => {};
		const { instance, answers } = commands({
			effects: {
				setModel: () =>
					new Promise<void>((resolve) => {
						finish = resolve;
					}),
			},
		});
		const running = instance.run(command("model.set", { provider: "rig", id: "slow" }, "c1"));
		await Promise.resolve();
		expect(answers).toEqual([]);
		finish();
		await running;
		expect(answers[0]).toMatchObject({ kind: "reply", id: "c1" });
	});

	test("a command refused by policy is answered as refused, and the promise chain goes on", async () => {
		const seen: string[] = [];
		const { instance, answers } = commands({
			effects: {
				setMode: (mode: string) => {
					if (mode === "full") throw new Refused("full is only set at the terminal");
					seen.push(mode);
				},
			},
		});
		const refused = instance.run(command("mode.set", { mode: "full" }, "c1"));
		const after = instance.run(command("session.rename", { name: "release check" }, "c2"));
		await Promise.all([refused, after]);
		expect(answers[0]).toMatchObject({ kind: "error", id: "c1" });
		// The command behind a refused one still runs: the queue never waits on a policy answer.
		expect(answers[1]).toMatchObject({ kind: "reply", id: "c2" });
		expect(seen).toEqual([]);
	});

	test("a reply that cannot go out does not leave the commands behind it unanswered", async () => {
		const answers: string[] = [];
		let fail = true;
		const instance = new Commands({
			session: "s1",
			effects: {
				abort: () => {},
				compact: () => {},
				rename: () => {},
				stop: () => {},
				setModel: () => Promise.resolve(),
				setThinking: () => {},
				setMode: () => {},
				prompt: () => {},
				clearQueue: () => [],
				answerAsk: () => {},
			},
			answer: (_kind, type, _data, id) => {
				// The reply and the error reply of the first command both miss their socket.
				if (fail && id === "c1") throw new Error("the socket went away mid-answer");
				fail = false;
				answers.push(`${type}:${id}`);
			},
			received: () => {},
			outcome: () => {},
		});
		void instance.run(command("run.abort", {}, "c1"));
		await instance.run(command("run.abort", {}, "c2"));
		expect(answers).toEqual(["run.abort:c2"]);
	});

	test("an effect that refuses the command answers with its reason, and the log says refused", async () => {
		const { instance, answers, log } = commands({
			effects: {
				stop: () => {
					throw new Refused("a forced stop needs a background session, which has a runner");
				},
			},
		});
		await instance.run(command("session.stop", { force: true }, "c1"));
		expect(answers[0]).toEqual({
			kind: "error",
			type: "session.stop",
			data: { reason: "a forced stop needs a background session, which has a runner" },
			id: "c1",
		});
		expect(log).toEqual(["received c1 session.stop", "refused c1 session.stop"]);
	});

	test("logs the id before it runs, and the outcome only when it did not run", async () => {
		const { instance, log } = commands();
		await instance.run(command("run.abort", {}, "c1"));
		await instance.run(command("session.fork", { entryId: "e1" }, "c2"));
		expect(log).toEqual([
			"received c1 run.abort",
			"received c2 session.fork",
			"refused c2 session.fork",
		]);
	});

	test("a repeat in the same run is answered as one and does nothing twice", async () => {
		const { instance, answers, done } = commands();
		await instance.run(command("session.compact", {}, "c1"));
		await instance.run(command("session.compact", {}, "c1"));
		expect(done).toEqual(["compact"]);
		expect(answers.at(-1)).toEqual({
			kind: "reply",
			type: "session.compact",
			data: { repeat: true },
			id: "c1",
		});
	});

	test("a repeat after a restart is a repeat, because the id came back from the log", async () => {
		const { instance, answers, done } = commands({ history: ["c1"] });
		await instance.run(command("session.compact", {}, "c1"));
		expect(done).toEqual([]);
		expect(answers[0]?.data).toEqual({ repeat: true });
	});

	test("a command this slice does not serve yet is refused with a reason, not run quietly", async () => {
		const { instance, answers, done } = commands();
		await instance.run(command("session.fork", { entryId: "e1" }, "c1"));
		expect(done).toEqual([]);
		expect(answers[0]).toEqual({
			kind: "error",
			type: "session.fork",
			data: { reason: "session.fork is not served by this session yet" },
			id: "c1",
		});
	});

	test("a command of a type nothing knows is refused before it is remembered", async () => {
		const { instance, answers, log } = commands();
		await instance.run(command("session.explode", {}, "c1"));
		expect(answers[0]).toMatchObject({ kind: "error", id: "c1" });
		expect(log).toEqual(["refused c1 session.explode"]);
	});

	test("a command missing a field it needs is refused, and a valid one after it still runs", async () => {
		const { instance, answers, done } = commands();
		await instance.run(command("session.rename", {}, "c1"));
		await instance.run(command("session.rename", { name: "named" }, "c2"));
		expect(answers[0]?.kind).toBe("error");
		expect(done).toEqual(["rename:named"]);
	});

	test("an effect that throws is answered as an error and logged as failed", async () => {
		const { instance, answers, log } = commands({
			effects: {
				abort: () => {
					throw new Error("the run was already over");
				},
			},
		});
		await instance.run(command("run.abort", {}, "c1"));
		expect(answers[0]).toEqual({
			kind: "error",
			type: "run.abort",
			data: { reason: "the run was already over" },
			id: "c1",
		});
		expect(log).toEqual(["received c1 run.abort", "failed c1 run.abort"]);
	});

	test("a command with no id is not run: nothing could answer it or call it a repeat", async () => {
		const { instance, done, answers } = commands();
		await instance.run(envelope("command", "run.abort", {}, { machine: "here", session: "s1" }));
		expect(done).toEqual([]);
		expect(answers).toEqual([]);
	});

	test("remembers the last thousand ids, and forgets the oldest", async () => {
		const { instance } = commands();
		for (let at = 0; at < KEPT_COMMANDS + 5; at += 1)
			await instance.run(command("run.abort", {}, `c${at}`));
		expect(instance.ran("c0")).toBe(false);
		expect(instance.ran(`c${KEPT_COMMANDS + 4}`)).toBe(true);
	});
});

describe("a client's answer to a question", () => {
	test("goes on the bus as the client's answer, with who gave it", async () => {
		const answers: { id: string; by?: By; result: unknown }[] = [];
		const instance = new Commands({
			session: "s1",
			effects: {
				abort: () => {},
				compact: () => {},
				rename: () => {},
				stop: () => {},
				setModel: () => Promise.resolve(),
				setThinking: () => {},
				setMode: () => {},
				prompt: () => {},
				clearQueue: () => [],
				answerAsk: (fields, by) =>
					answers.push({ id: String(fields.ask), by, result: fields.result }),
			},
			answer: () => {},
			received: () => {},
			outcome: () => {},
		});
		const by = { kind: "client", name: "my phone", machine: "phone" } as const;
		await instance.run({
			v: 1,
			kind: "command",
			type: "ask.answer",
			id: "a1",
			data: { ask: "q1", result: { answers: [], cancelled: false } },
			by,
			at: 0,
		});
		expect(answers).toEqual([{ id: "q1", by, result: { answers: [], cancelled: false } }]);
	});

	test("a command without the question's id is refused before any effect runs", async () => {
		const done: string[] = [];
		const instance = new Commands({
			session: "s1",
			effects: {
				abort: () => {},
				compact: () => {},
				rename: () => {},
				stop: () => {},
				setModel: () => Promise.resolve(),
				setThinking: () => {},
				setMode: () => {},
				prompt: () => {},
				clearQueue: () => [],
				answerAsk: () => done.push("ask"),
			},
			answer: (_kind, _type, data) => done.push(`error:${String(data.reason)}`),
			received: () => {},
			outcome: () => {},
		});
		await instance.run({
			v: 1,
			kind: "command",
			type: "ask.answer",
			id: "a1",
			data: { result: { answers: [] } },
			at: 0,
		});
		expect(done).toEqual(["error:the command is not one this session knows, or it lacks a field"]);
	});
});

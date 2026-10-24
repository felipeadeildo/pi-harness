import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import { askQuestions, canAsk } from "../src/ask/client.ts";
import {
	ANSWER,
	ASK,
	AVAILABLE,
	type AskCancel,
	type AskRequest,
	type AskResult,
	CANCEL,
} from "../src/contracts/ask.ts";
import type { By } from "../src/contracts/by.ts";
import { LOGGED_EVENT, type LoggedEvent } from "../src/events/log.ts";

const QUESTION = {
	header: "Auth",
	question: "Which auth?",
	options: [{ label: "OAuth", description: "login", preview: "```\n[ in ]\n```" }],
};

function provider(
	bus: ReturnType<typeof createEventBus>,
	result: AskResult,
	requests: AskRequest[],
) {
	bus.on(AVAILABLE, (data: unknown) => void ((data as { available: boolean }).available = true));
	bus.on(ASK, (data: unknown) => {
		const request = data as AskRequest;
		requests.push(request);
		bus.emit(ANSWER, { id: request.id, result });
	});
}

test("with no provider the questions cannot be asked", () => {
	expect(canAsk(createEventBus())).toBe(false);
});

test("the answer comes back with the request id", async () => {
	const bus = createEventBus();
	const requests: AskRequest[] = [];
	const answer: AskResult = {
		answers: [{ question: "Which auth?", header: "Auth", picked: ["OAuth"], notes: [] }],
		cancelled: false,
	};
	provider(bus, answer, requests);

	expect(canAsk(bus)).toBe(true);
	expect(await askQuestions(bus, [QUESTION])).toEqual(answer);
	expect(requests[0]?.questions).toEqual([QUESTION]);
});

test("an answer for another request is ignored", async () => {
	const bus = createEventBus();
	provider(bus, { answers: [], cancelled: true }, []);
	bus.emit(ANSWER, { id: "another", result: { answers: [], cancelled: false } });
	expect(await askQuestions(bus, [QUESTION])).toEqual({ answers: [], cancelled: true });
});

test("an answer that does not decode becomes a cancelled result", async () => {
	const bus = createEventBus();
	bus.on(ASK, (data: unknown) => bus.emit(ANSWER, { id: (data as AskRequest).id, result: "nope" }));
	expect(await askQuestions(bus, [QUESTION])).toEqual({
		answers: [],
		cancelled: true,
		error: "the answer did not decode",
	});
});

const PHONE: By = { kind: "client", name: "phone", machine: "laptop" };
const TERMINAL: By = { kind: "terminal", name: "otter", machine: "laptop" };
const PICKED: AskResult = {
	answers: [{ question: "Which auth?", header: "Auth", picked: ["OAuth"], notes: [] }],
	cancelled: false,
};

/** A bus that records every ask, cancel and logged event, with a provider that holds its asks. */
function rig() {
	const bus = createEventBus();
	const asks: AskRequest[] = [];
	const cancels: AskCancel[] = [];
	const logged: LoggedEvent[] = [];
	bus.on(ASK, (data: unknown) => asks.push(data as AskRequest));
	bus.on(CANCEL, (data: unknown) => cancels.push(data as AskCancel));
	bus.on(LOGGED_EVENT, (data: unknown) => logged.push(data as LoggedEvent));
	const answer = (by: By | undefined, result = PICKED) =>
		bus.emit(ANSWER, { id: asks.at(-1)?.id, result, ...(by === undefined ? {} : { by }) });
	return { bus, asks, cancels, logged, answer };
}

const ctx = {
	sessionManager: { getCwd: () => "/home/me/repo", getSessionId: () => "s1" },
};

describe("closing a question", () => {
	let root: string;
	let saved: string | undefined;
	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "ask-"));
		saved = process.env.PI_HARNESS_EVENTS;
		process.env.PI_HARNESS_EVENTS = root;
	});
	afterAll(() => {
		if (saved === undefined) delete process.env.PI_HARNESS_EVENTS;
		else process.env.PI_HARNESS_EVENTS = saved;
		rmSync(root, { recursive: true, force: true });
	});

	test("an abort resolves the call as cancelled, and tells the provider to close", async () => {
		const { bus, cancels } = rig();
		const abort = new AbortController();
		const asking = askQuestions(bus, [QUESTION], { signal: abort.signal });
		abort.abort();
		expect(await asking).toEqual({ answers: [], cancelled: true });
		expect(cancels).toEqual([{ id: expect.any(String), reason: "aborted" }]);
	});

	test("a signal aborted before the call asks nothing", async () => {
		const { bus, asks, cancels, logged } = rig();
		const abort = new AbortController();
		abort.abort();
		const result = await askQuestions(bus, [QUESTION], { signal: abort.signal, ctx });
		expect(result.cancelled).toBe(true);
		expect([asks, cancels, logged]).toEqual([[], [], []]);
	});

	test("the first answer wins, and every provider hears the question closed", async () => {
		const { bus, asks, cancels, answer } = rig();
		const asking = askQuestions(bus, [QUESTION]);
		answer(PHONE);
		answer(TERMINAL, { answers: [], cancelled: true });
		expect(await asking).toEqual({ ...PICKED, by: PHONE });
		expect(cancels).toEqual([{ id: asks[0]!.id, reason: "answered" }]);
	});

	test("an abort after the answer changes nothing", async () => {
		const { bus, cancels, answer, logged } = rig();
		const abort = new AbortController();
		const asking = askQuestions(bus, [QUESTION], {
			signal: abort.signal,
			ctx,
			cancelledBy: TERMINAL,
		});
		answer(PHONE);
		abort.abort();
		expect(await asking).toEqual({ ...PICKED, by: PHONE });
		expect(cancels.map((cancel) => cancel.reason)).toEqual(["answered"]);
		expect(logged.filter((event) => event.type === "ask.closed")).toHaveLength(1);
	});

	test("the call stops listening once it closes, by an answer or by an abort", async () => {
		const { bus, answer } = rig();
		let listening = 0;
		const counted = {
			emit: bus.emit.bind(bus),
			on(channel: string, handler: (data: unknown) => void) {
				listening += 1;
				const stop = bus.on(channel, handler);
				return () => {
					listening -= 1;
					stop();
				};
			},
		};
		const answered = askQuestions(counted, [QUESTION]);
		answer(PHONE);
		await answered;
		const abort = new AbortController();
		const aborted = askQuestions(counted, [QUESTION], { signal: abort.signal });
		abort.abort();
		await aborted;
		expect(listening).toBe(0);
	});

	test("ask.opened and ask.closed reach the log once each, with who answered", async () => {
		const { bus, asks, answer, logged } = rig();
		const asking = askQuestions(bus, [QUESTION], { ctx, source: "ask-permission", id: "call-1" });
		answer(PHONE);
		await asking;
		expect(asks[0]?.id).toBe("call-1");
		expect(logged.map((event): unknown[] => [event.type, event.data])).toEqual([
			["ask.opened", { id: "call-1", source: "ask-permission", questions: [QUESTION] }],
			["ask.closed", { id: "call-1", by: PHONE, result: PICKED }],
		]);
	});

	test("an answer that says nobody is logged without a by, never as the terminal", async () => {
		const { bus, answer, logged } = rig();
		const asking = askQuestions(bus, [QUESTION], { ctx });
		answer(undefined);
		await asking;
		expect(logged.at(-1)?.data).not.toHaveProperty("by");
	});

	test("the reply says who answered, and an abort says who gave up only when told", async () => {
		const { bus, answer } = rig();
		const answered = askQuestions(bus, [QUESTION]);
		answer(PHONE);
		expect((await answered).by).toEqual(PHONE);

		const unnamed = askQuestions(bus, [QUESTION]);
		answer(undefined);
		expect(await unnamed).not.toHaveProperty("by");

		const abort = new AbortController();
		const aborted = askQuestions(bus, [QUESTION], { signal: abort.signal });
		abort.abort();
		expect(await aborted).not.toHaveProperty("by");
	});

	test("an abort is logged with whoever the caller says gave up", async () => {
		const { bus, logged } = rig();
		const abort = new AbortController();
		const asking = askQuestions(bus, [QUESTION], {
			ctx,
			signal: abort.signal,
			cancelledBy: TERMINAL,
		});
		abort.abort();
		await asking;
		expect(logged.at(-1)?.data).toMatchObject({ by: TERMINAL, result: { cancelled: true } });
	});
});

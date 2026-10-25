// pi's and other extensions' dialogs in a terminal session: the terminal and the clients race, and the
// first answer wins.
import { describe, expect, test } from "bun:test";

import {
	ANSWER,
	ASK,
	type AskRequest,
	type AskResult,
	type By,
	CANCEL,
	isObject,
} from "@adeildo/pi-kit";
import { createEventBus } from "@earendil-works/pi-coding-agent";

import { forwardDialogs } from "../src/bridge/dialogs.ts";

const TERMINAL: By = { kind: "terminal", name: "otter", machine: "laptop" };
const PHONE: By = { kind: "client", name: "phone", machine: "laptop" };

interface Open {
	signal: AbortSignal | undefined;
	answer(value: unknown): void;
}

/** A terminal whose dialogs wait for `answer`, and end as undefined when their signal aborts. */
function rig(enabled = true) {
	const events = createEventBus();
	const asked: AskRequest[] = [];
	const answers: unknown[] = [];
	events.on(ASK, (data) => void asked.push(data as AskRequest));
	events.on(ANSWER, (data) => void answers.push(data));
	const opened: Open[] = [];
	const dialog =
		(cancelled: unknown) =>
		(_title: string, ...rest: unknown[]) => {
			const signal = (rest.at(-1) as { signal?: AbortSignal } | undefined)?.signal;
			return new Promise((resolve) => {
				opened.push({ signal, answer: resolve });
				signal?.addEventListener("abort", () => resolve(cancelled), { once: true });
			});
		};
	const ui = {
		select: dialog(undefined),
		confirm: dialog(false),
		input: dialog(undefined),
	} as never as Parameters<typeof forwardDialogs>[0];
	const original = { ...ui };
	const restore = forwardDialogs(ui, {
		events,
		ctx: undefined,
		terminal: () => TERMINAL,
		enabled: () => enabled,
	});
	const clientAnswers = (result: AskResult) =>
		events.emit(ANSWER, { id: asked[0]?.id, by: PHONE, result });
	return { ui, original, restore, events, asked, answers, opened, clientAnswers };
}

const pick = (value: string): AskResult => ({
	answers: [{ question: "q", header: "h", picked: [value], notes: [] }],
	cancelled: false,
});

const until = async (done: () => boolean) => {
	for (let wait = 0; !done() && wait < 100; wait++) await Promise.resolve();
};

describe("a select, confirm or input in a terminal session", () => {
	test("a client's answer reaches the extension and closes the terminal's dialog", async () => {
		const { ui, asked, opened, clientAnswers } = rig();
		const choice = ui.select("Branch", ["main", "dev"]);
		await until(() => opened.length === 1);
		expect(asked[0]).toMatchObject({
			drawn: true,
			questions: [{ header: "Branch", options: [{ label: "main" }, { label: "dev" }] }],
		});

		clientAnswers(pick("dev"));

		expect(await choice).toBe("dev");
		expect(opened[0]?.signal?.aborted).toBe(true);
	});

	test("a client that answered first is the only answer, even when the terminal settles late", async () => {
		const { ui, answers, opened, clientAnswers } = rig();
		const choice = ui.select("Branch", ["main", "dev"]);
		await until(() => opened.length === 1);

		clientAnswers(pick("dev"));
		await choice;
		await Promise.resolve();

		expect(answers).toHaveLength(1);
		expect(answers[0]).toMatchObject({ by: PHONE });
	});

	test("the terminal's answer closes the clients' question under the terminal's name", async () => {
		const { ui, answers, opened } = rig();
		const choice = ui.select("Branch", ["main", "dev"]);
		await until(() => opened.length === 1);

		opened[0]?.answer("main");

		expect(await choice).toBe("main");
		expect(answers).toEqual([
			expect.objectContaining({
				by: TERMINAL,
				result: { cancelled: false, answers: [expect.objectContaining({ picked: ["main"] })] },
			}),
		]);
	});

	test("a confirm answers with a boolean from either side", async () => {
		const first = rig();
		const yes = first.ui.confirm("Delete", "Delete the branch?");
		await until(() => first.opened.length === 1);
		first.clientAnswers(pick("No"));
		expect(await yes).toBe(false);

		const second = rig();
		const no = second.ui.confirm("Delete", "Delete the branch?");
		await until(() => second.opened.length === 1);
		second.opened[0]?.answer(true);
		expect(await no).toBe(true);
	});

	test("an input is a question with a row for words and no options", async () => {
		const { ui, asked, opened, clientAnswers } = rig();
		const text = ui.input("Name", "a name");
		await until(() => opened.length === 1);
		expect(asked[0]?.questions[0]).toMatchObject({ options: [] });
		expect(asked[0]?.questions[0]?.typed).toBeUndefined();

		clientAnswers({
			answers: [{ question: "Name", header: "Name", picked: [], typed: "ada", notes: [] }],
			cancelled: false,
		});

		expect(await text).toBe("ada");
	});

	test("a dialog closed in the terminal with no answer ends as no answer", async () => {
		const { ui, opened } = rig();
		const choice = ui.select("Branch", ["main"]);
		await until(() => opened.length === 1);
		opened[0]?.answer(undefined);
		expect(await choice).toBeUndefined();
	});

	test("a stop that cancels the open questions ends the wait", async () => {
		const { ui, asked, opened, events } = rig();
		const choice = ui.select("Branch", ["main"]);
		await until(() => opened.length === 1);

		events.emit(CANCEL, { id: asked[0]?.id });

		expect(await choice).toBeUndefined();
	});

	test("the caller's own signal still closes the dialog", async () => {
		const { ui, opened } = rig();
		const abort = new AbortController();
		const choice = ui.select("Branch", ["main"], { signal: abort.signal });
		await until(() => opened.length === 1);

		abort.abort();

		expect(await choice).toBeUndefined();
		expect(opened[0]?.signal?.aborted).toBe(true);
	});

	test("with the setting off nothing goes to the clients", async () => {
		const { ui, asked, opened } = rig(false);
		const choice = ui.select("Branch", ["main"]);
		await until(() => opened.length === 1);

		opened[0]?.answer("main");

		expect(await choice).toBe("main");
		expect(asked).toEqual([]);
		expect(isObject(opened[0]) && opened[0].signal).toBeUndefined();
	});

	test("restoring puts the terminal's own dialogs back", () => {
		const { ui, original, restore } = rig();
		expect(ui.select).not.toBe(original.select);
		restore();
		expect(ui.select).toBe(original.select);
		expect(ui.confirm).toBe(original.confirm);
		expect(ui.input).toBe(original.input);
	});
});

// Pi's dialogs in a terminal session also go to the clients as an ask. The first answer wins: a
// client's closes the terminal dialog through its signal, and the terminal's closes the ask.
import {
	ANSWER,
	type AskOptions,
	type AskQuestion,
	type AskReply,
	type AskResult,
	askQuestions,
	type By,
	CANCEL,
	isObject,
} from "@adeildo/pi-kit";
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

type Events = ExtensionAPI["events"];
type Dialogs = Pick<ExtensionUIContext, "select" | "confirm" | "input">;
type DialogOptions = Parameters<ExtensionUIContext["select"]>[2];

export interface DialogsOptions {
	events: Events;
	ctx: AskOptions["ctx"];
	terminal: () => By;
	/** Read at each dialog, so the setting applies without a reload. */
	enabled: () => boolean;
}

const CANCELLED: AskResult = { answers: [], cancelled: true };
const YES = "Yes";
const NO = "No";

function picked(question: AskQuestion, value: string): AskResult {
	const answer = {
		question: question.question,
		header: question.header,
		picked: [value],
		notes: [],
	};
	return { answers: [answer], cancelled: false };
}

function typed(question: AskQuestion, value: string): AskResult {
	const answer = {
		question: question.question,
		header: question.header,
		picked: [],
		typed: value,
		notes: [],
	};
	return { answers: [answer], cancelled: false };
}

/** Returns what restores the originals. The editor is left alone: pi gives it no signal. */
export function forwardDialogs(ui: Dialogs, options: DialogsOptions): () => void {
	const original = { select: ui.select, confirm: ui.confirm, input: ui.input };

	async function race(
		source: string,
		question: AskQuestion,
		outer: AbortSignal | undefined,
		ask: (signal: AbortSignal) => Promise<AskResult | undefined>,
	): Promise<AskReply> {
		const id = crypto.randomUUID();
		const terminal = new AbortController();
		// The bridge's stop closes with no reason and still needs the terminal's answer to end the wait.
		let closed = false;
		const stop = options.events.on(CANCEL, (data: unknown) => {
			if (!isObject(data) || data.id !== id) return;
			closed = data.reason !== undefined;
			terminal.abort();
		});
		const reply = askQuestions(options.events, [question], {
			id,
			source,
			signal: outer,
			ctx: options.ctx,
			drawn: true,
		});
		void ask(terminal.signal).then((result) => {
			if (closed) return;
			options.events.emit(ANSWER, { id, by: options.terminal(), result: result ?? CANCELLED });
		});
		try {
			return await reply;
		} finally {
			stop();
			terminal.abort();
		}
	}

	const within = (dialog: DialogOptions, signal: AbortSignal): DialogOptions => ({
		...dialog,
		signal: dialog?.signal === undefined ? signal : AbortSignal.any([dialog.signal, signal]),
	});

	ui.select = async (title, choices, dialog) => {
		if (!options.enabled()) return original.select.call(ui, title, choices, dialog);
		const question: AskQuestion = {
			header: title,
			question: title,
			options: choices.map((label) => ({ label })),
			typed: false,
		};
		const reply = await race("ui.select", question, dialog?.signal, async (signal) => {
			const value = await original.select.call(ui, title, choices, within(dialog, signal));
			return value === undefined ? undefined : picked(question, value);
		});
		return reply.cancelled ? undefined : reply.answers[0]?.picked[0];
	};

	ui.confirm = async (title, message, dialog) => {
		if (!options.enabled()) return original.confirm.call(ui, title, message, dialog);
		const question: AskQuestion = {
			header: title,
			question: message,
			options: [{ label: YES }, { label: NO }],
			typed: false,
		};
		const reply = await race("ui.confirm", question, dialog?.signal, async (signal) => {
			const yes = await original.confirm.call(ui, title, message, within(dialog, signal));
			return picked(question, yes ? YES : NO);
		});
		return !reply.cancelled && reply.answers[0]?.picked[0] === YES;
	};

	ui.input = async (title, placeholder, dialog) => {
		if (!options.enabled()) return original.input.call(ui, title, placeholder, dialog);
		const question: AskQuestion = { header: title, question: title, options: [] };
		const reply = await race("ui.input", question, dialog?.signal, async (signal) => {
			const value = await original.input.call(ui, title, placeholder, within(dialog, signal));
			return value === undefined ? undefined : typed(question, value);
		});
		return reply.cancelled ? undefined : reply.answers[0]?.typed;
	};

	return () => Object.assign(ui, original);
}

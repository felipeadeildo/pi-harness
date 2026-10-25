// The dialogs of pi and of other extensions, in a terminal session. `select`, `confirm` and `input`
// open in the terminal as they always did, and the same question goes to the clients as an ask the
// terminal already draws. The first answer wins: a client's closes the terminal's dialog through the
// signal pi gives each dialog, and the terminal's answers the clients' ask.
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
	/** The session whose log records the asks. */
	ctx: AskOptions["ctx"];
	/** Who the terminal is, as the author of an answer given there. */
	terminal: () => By;
	/** Read at each dialog, so the setting takes effect without a reload. */
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

/**
 * Wraps the three dialogs on the shared `ui`, and returns what puts the originals back. The editor is
 * left alone: pi gives it no signal, so a client's answer could not close the terminal's.
 */
export function forwardDialogs(ui: Dialogs, options: DialogsOptions): () => void {
	const original = { select: ui.select, confirm: ui.confirm, input: ui.input };

	/** Asks the terminal and the clients at once, and settles on whichever answers first. */
	async function race(
		source: string,
		question: AskQuestion,
		outer: AbortSignal | undefined,
		ask: (signal: AbortSignal) => Promise<AskResult | undefined>,
	): Promise<AskReply> {
		const id = crypto.randomUUID();
		const terminal = new AbortController();
		// A close the kit announces says why. The bridge's stop closes with no reason, and that one still
		// needs the terminal's answer to end the wait.
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

	/** The signal a dialog gets: the terminal's own, and the caller's when it passed one. */
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

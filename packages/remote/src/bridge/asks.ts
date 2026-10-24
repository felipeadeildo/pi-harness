// The harness's questions in a session with no terminal. There the bridge answers the kit's
// `AVAILABLE` itself, so the features that ask (the model's own questions and the permission gate)
// go through the bus instead of a dialog nobody can see. A client then answers with `ask.answer`,
// which arrives on the socket, and the answer goes back on the bus as one from a client, so the asker
// sees a normal answer and never learns that it happened on a phone.
import {
	type AnswerEvent,
	ANSWER,
	ASK,
	type AskResult,
	AVAILABLE,
	CANCEL,
	isObject,
	type By,
} from "@adeildo/pi-kit";

export interface AsksOptions {
	/** The kit's bus, which every feature in this pi shares. */
	events: {
		on(type: string, handler: (data: unknown) => void): () => void;
		emit(type: string, data: unknown): void;
	};
	/** Sends a question to the clients, and tells them when it closes. */
	send(event: { type: "ask.opened" | "ask.closed"; data: unknown }): void;
	warn(message: string): void;
}

/** The answer a question closed without a client says: nobody chose, and it did not go unanswered. */
const CANCELLED: AskResult = { answers: [], cancelled: true };

/** What a client's `ask.answer` carries: the question, the answer, and who gave it. */
export interface ClientAnswer {
	/** The ask's id. */
	ask: string;
	result: AskResult;
	/** The client's own name and machine, which the command's envelope carries. */
	by: By;
}

/**
 * Answers the kit's questions for the clients, and takes their answers. Only for a session with no
 * terminal: one with a terminal draws its own dialog, and the phone answers beside it (A5 of the
 * plan); here there is nothing to race.
 */
export class ClientAsks {
	readonly #options: AsksOptions;
	readonly #open = new Set<string>();
	readonly #stops: (() => void)[] = [];

	constructor(options: AsksOptions) {
		this.#options = options;
	}

	start(): void {
		const { events } = this.#options;
		this.#stops.push(
			events.on(AVAILABLE, (data: unknown) => {
				if (isObject(data)) data.available = true;
			}),
			events.on(ASK, (data: unknown) => this.#asked(data)),
			// Someone else answered or gave up: the clients' dialog closes, and no answer goes back.
			events.on(CANCEL, (data: unknown) => {
				const id = isObject(data) && typeof data.id === "string" ? data.id : undefined;
				if (id === undefined || !this.#open.delete(id)) return;
				this.#close(id, CANCELLED);
			}),
		);
	}

	stop(): void {
		for (const stop of this.#stops.splice(0)) stop();
		// A question still waiting would stay open in every client's state with nobody to answer it:
		// the bridge is leaving the bus, so it closes each one as it goes. `#close` sends, and does
		// not touch the set, so iterating it here is safe.
		for (const id of this.#open) this.#close(id, CANCELLED);
		this.#open.clear();
	}

	/** A client answered. False when the question is not open, or was answered before. */
	answer(answer: ClientAnswer): boolean {
		if (!this.#open.delete(answer.ask)) return false;
		const event: AnswerEvent = { id: answer.ask, by: answer.by, result: answer.result };
		this.#options.events.emit(ANSWER, event);
		this.#close(answer.ask, answer.result, answer.by);
		return true;
	}

	/** The ids of the questions waiting for a client, which the command handler checks against. */
	get waiting(): readonly string[] {
		return [...this.#open];
	}

	#asked(data: unknown): void {
		if (!isObject(data) || typeof data.id !== "string") {
			this.#options.warn("a question with no id, so no client can answer it");
			return;
		}
		this.#open.add(data.id);
		// No fact is sent from here: the ask client logs `ask.opened` and `ask.closed`, and the bridge
		// forwards the log. Two producers meant two copies, and the second one erased the author.
	}

	/**
	 * Everything a closed question owes. The fact is what a client's state reduces, and it only reads
	 * with a `result`. The bus's `CANCEL` is what the session's status watches: without it the session
	 * stays blocked on a question nobody is waiting on any more.
	 */
	#close(id: string, result: AskResult, by?: By): void {
		// The `CANCEL` stays: it is what the session's status watches to leave `blocked`. The fact is
		// the log's, written by the ask client with the same answer and the same author.
		this.#options.events.emit(CANCEL, { id, ...(by === undefined ? {} : { by }) });
	}
}

/**
 * The questions open in this session, by id. A stop closes each one as a no before it aborts, so the
 * extension that is waiting hears "no" and not an error, and no client is left with a dialog for a
 * session that is going away.
 */
export class OpenAsks {
	readonly #ids = new Set<string>();
	readonly #stops: (() => void)[] = [];

	/** Follows the bus: `ASK` opens a question, and an answer or a cancel closes it. */
	watch(events: AsksOptions["events"]): void {
		const tell = (data: unknown, open: boolean) => {
			if (!isObject(data) || typeof data.id !== "string") return;
			if (open) this.#ids.add(data.id);
			else this.#ids.delete(data.id);
		};
		this.#stops.push(
			events.on(ASK, (data: unknown) => tell(data, true)),
			events.on(ANSWER, (data: unknown) => tell(data, false)),
			events.on(CANCEL, (data: unknown) => tell(data, false)),
		);
	}

	/** The ids still waiting, which a stop cancels. */
	get open(): readonly string[] {
		return [...this.#ids];
	}

	stop(): void {
		for (const stop of this.#stops.splice(0)) stop();
	}
}

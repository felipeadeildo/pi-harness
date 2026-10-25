// The harness's questions in a session with no terminal: a client answers on the bus, as a client.
import { ANSWER, ASK, type AskResult, AVAILABLE, CANCEL, isObject, type By } from "@adeildo/pi-kit";

export interface AsksOptions {
	/** The bus every feature in this pi shares. */
	events: {
		on(type: string, handler: (data: unknown) => void): () => void;
		emit(type: string, data: unknown): void;
	};
	/** Tells the clients a question opened, and when it closed. */
	send(event: { type: "ask.opened" | "ask.closed"; data: unknown }): void;
	warn(message: string): void;
}

/** Nobody chose, and it did not go unanswered. */
const CANCELLED: AskResult = { answers: [], cancelled: true };

/** Answers the kit's questions for the clients, which is only a session without a terminal. */
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
			// The ask client logs and hands the answer over; this side stops counting.
			events.on(ANSWER, (data: unknown) => {
				const id = isObject(data) && typeof data.id === "string" ? data.id : undefined;
				if (id !== undefined) this.#open.delete(id);
			}),
			// Answered elsewhere: the dialog closes and no answer goes back.
			events.on(CANCEL, (data: unknown) => {
				const id = isObject(data) && typeof data.id === "string" ? data.id : undefined;
				if (id === undefined || !this.#open.delete(id)) return;
				this.#close(id, CANCELLED);
			}),
		);
	}

	stop(): void {
		for (const stop of this.#stops.splice(0)) stop();
		// A shutdown writes no answer and no abort, so the bridge writes this close itself.
		for (const id of this.#open) this.#closedOnStop(id);
		this.#open.clear();
	}

	/** The close a shutdown writes, which the log never carries. */
	#closedOnStop(id: string): void {
		this.#options.send({ type: "ask.closed", data: { id, result: CANCELLED } });
		this.#close(id, CANCELLED);
	}

	#asked(data: unknown): void {
		if (!isObject(data) || typeof data.id !== "string") {
			this.#options.warn("a question with no id, so no client can answer it");
			return;
		}
		this.#open.add(data.id);
		// Two producers meant two copies, and the second erased the author.
	}

	/**
	 * What a closed question owes everyone else: the `CANCEL` the session's status watches to leave
	 * `blocked`. The state change is the log's, except for the one a shutdown writes.
	 */
	#close(id: string, _result: AskResult, by?: By): void {
		// The `CANCEL` stays: the state change is the log's, with the same answer and the same author.
		this.#options.events.emit(CANCEL, { id, ...(by === undefined ? {} : { by }) });
	}
}

/** The questions open here, by id: a stop closes each as a no, so the waiting extension hears it. */
export class OpenAsks {
	readonly #ids = new Set<string>();
	readonly #stops: (() => void)[] = [];

	/** `ASK` opens a question; an answer or a cancel closes it. */
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

	/** The ids still waiting. */
	get open(): readonly string[] {
		return [...this.#ids];
	}

	stop(): void {
		for (const stop of this.#stops.splice(0)) stop();
	}
}

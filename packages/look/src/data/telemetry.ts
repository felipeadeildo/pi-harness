// The clock behind the speeds. A run is everything between the prompt and the agent settling; a
// request is one call to the model inside it. Both are measured from the message events, because pi
// records usage without a duration.
//
// Two speeds per request, one for each direction:
//   ↑ prefill: prompt tokens over the wait for the first token, how fast what we sent was taken in
//   ↓ decode:  output tokens over the time spent writing, how fast the answer comes back
import {
	emptyTotals,
	perSecond,
	promptOf,
	type RequestRecord,
	type Totals,
	usageTotals,
} from "./totals.ts";

/** A decode speed over less than this is noise, so it waits. */
const MIN_SAMPLE_MS = 250;
/** Close enough for a live number: the provider's real count replaces it at the end. */
const CHARS_PER_TOKEN = 4;

export interface RequestView {
	/** The answer is still arriving. */
	streaming: boolean;
	/** Waiting for the first token right now. */
	waiting: boolean;
	/** Since the request left, frozen when it ends. */
	elapsedMs: number;
	firstTokenMs: number | undefined;
	/** Output tokens per second, live while streaming. */
	decode: number | undefined;
	/** Prompt tokens per second of waiting, once the prompt size is known. */
	prefill: number | undefined;
	/** What this request used so far. */
	usage: Totals;
	/** The output count is an estimate until the provider reports it. */
	estimated: boolean;
}

export interface RunView {
	running: boolean;
	elapsedMs: number;
	/** Requests made in this run. */
	requests: number;
}

interface Request {
	startedAt: number;
	firstTokenAt: number | undefined;
	endedAt: number | undefined;
	usage: Totals;
	/** Characters seen, for a live rate before the provider says how many tokens they were. */
	characters: number;
}

interface Run {
	startedAt: number;
	endedAt: number | undefined;
	requests: number;
}

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

export class Telemetry {
	readonly #now: () => number;
	#run: Run | undefined;
	#request: Request | undefined;
	/** The last request that finished, frozen, so a line can show numbers that no longer move. */
	#last: RequestView | undefined;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	runStarted(): void {
		this.#run = { startedAt: this.#now(), endedAt: undefined, requests: 0 };
	}

	runEnded(): void {
		if (this.#run !== undefined && this.#run.endedAt === undefined) this.#run.endedAt = this.#now();
	}

	/** A turn starting is the request leaving. */
	requestStarted(): void {
		this.#request = {
			startedAt: this.#now(),
			firstTokenAt: undefined,
			endedAt: undefined,
			usage: emptyTotals(),
			characters: 0,
		};
		if (this.#run === undefined || this.#run.endedAt !== undefined) this.runStarted();
		if (this.#run !== undefined) this.#run.requests++;
	}

	/** The assistant message opening. Starts a request when no turn announced one. */
	answerStarted(): void {
		if (this.#request === undefined || this.#request.endedAt !== undefined) this.requestStarted();
	}

	/** A piece of the answer: text, thinking or a tool call being written. */
	answerGrew(delta: string, usage: UsageLike): void {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return;
		request.usage = usageTotals(usage);
		if (delta.length === 0) return;
		request.characters += delta.length;
		request.firstTokenAt ??= this.#now();
	}

	/** The answer is complete. Returns what the session keeps, or nothing when there was no answer. */
	answerEnded(usage: UsageLike): RequestRecord | undefined {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return undefined;

		const now = this.#now();
		request.endedAt = now;
		request.usage = usageTotals(usage);
		if (request.usage.output === 0 && request.firstTokenAt === undefined) return undefined;

		const firstTokenAt = request.firstTokenAt ?? now;
		this.#last = this.request();
		return {
			output: request.usage.output,
			prompt: promptOf(request.usage),
			firstTokenMs: firstTokenAt - request.startedAt,
			generationMs: now - firstTokenAt,
		};
	}

	/** The request running now, or the last one. */
	request(): RequestView | undefined {
		const request = this.#request;
		if (request === undefined) return undefined;

		const now = this.#now();
		const streaming = request.endedAt === undefined;
		const firstTokenMs =
			request.firstTokenAt === undefined ? undefined : request.firstTokenAt - request.startedAt;
		const estimated = streaming && request.usage.output === 0;
		const output = estimated
			? Math.round(request.characters / CHARS_PER_TOKEN)
			: request.usage.output;
		const writingMs =
			request.firstTokenAt === undefined ? 0 : (request.endedAt ?? now) - request.firstTokenAt;

		return {
			streaming,
			waiting: streaming && request.firstTokenAt === undefined,
			elapsedMs: (request.endedAt ?? now) - request.startedAt,
			firstTokenMs,
			decode: writingMs < MIN_SAMPLE_MS && streaming ? undefined : perSecond(output, writingMs),
			prefill:
				firstTokenMs === undefined ? undefined : perSecond(promptOf(request.usage), firstTokenMs),
			usage: { ...request.usage, output },
			estimated,
		};
	}

	/** The last request that finished. Undefined until one has. */
	last(): RequestView | undefined {
		return this.#last;
	}

	/** The run going now, or the last one. */
	run(): RunView | undefined {
		const run = this.#run;
		if (run === undefined) return undefined;
		const running = run.endedAt === undefined;
		return {
			running,
			elapsedMs: (run.endedAt ?? this.#now()) - run.startedAt,
			requests: run.requests,
		};
	}

	reset(): void {
		this.#run = undefined;
		this.#request = undefined;
		this.#last = undefined;
	}
}

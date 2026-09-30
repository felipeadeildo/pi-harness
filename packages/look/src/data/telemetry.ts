import {
	emptyTotals,
	perSecond,
	promptOf,
	type RequestRecord,
	type Totals,
	usageTotals,
} from "./totals.ts";

const MIN_SAMPLE_MS = 250;
const CHARS_PER_TOKEN = 4;

export interface RequestView {
	streaming: boolean;
	waiting: boolean;
	elapsedMs: number;
	firstTokenMs: number | undefined;
	decode: number | undefined;
	prefill: number | undefined;
	usage: Totals;
	estimated: boolean;
}

export interface RunView {
	running: boolean;
	elapsedMs: number;
	requests: number;
}

interface Request {
	startedAt: number;
	firstTokenAt: number | undefined;
	endedAt: number | undefined;
	usage: Totals;
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

	answerStarted(): void {
		if (this.#request === undefined || this.#request.endedAt !== undefined) this.requestStarted();
	}

	answerGrew(delta: string, usage: UsageLike): void {
		const request = this.#request;
		if (request === undefined || request.endedAt !== undefined) return;
		request.usage = usageTotals(usage);
		if (delta.length === 0) return;
		request.characters += delta.length;
		request.firstTokenAt ??= this.#now();
	}

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

	last(): RequestView | undefined {
		return this.#last;
	}

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

// When the goal's model runs: on your message, once per interval during a run, and at its end.
import { type GoalUpdate, oneAtATime } from "@adeildo/pi-kit";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { propose, tidy } from "./ask.ts";
import type { Keeper } from "./keeper.ts";
import { type Excerpt, lastMessage, sessionSince, workSince } from "./transcript.ts";

export interface UpdateOptions {
	models(ctx: ExtensionContext): Model<Api>[];
	/** Seconds between updates during a run. 0 waits for the end of the run. */
	interval(): number;
}

export class Updates {
	readonly #keeper: Keeper;
	readonly #options: UpdateOptions;
	readonly #turns = oneAtATime();
	#stop = new AbortController();
	#working = false;
	#lastWork = 0;
	#workTimer: ReturnType<typeof setTimeout> | undefined;
	#workReadTo: string | undefined;
	#tidiedTo: string | undefined;
	#untidy = false;
	/** Settles once your last message is in the timeline. */
	settling: Promise<void> | undefined;

	constructor(keeper: Keeper, options: UpdateOptions) {
		this.#keeper = keeper;
		this.#options = options;
	}

	get working(): boolean {
		return this.#working;
	}

	/** A timeline that comes back from a file gets one tidy pass after the next run. */
	reset(): void {
		this.#workReadTo = undefined;
		this.#tidiedTo = undefined;
		this.#untidy = this.#keeper.state().items.length > 0;
	}

	start(): void {
		this.#stop = new AbortController();
	}

	stop(): void {
		this.#stop.abort();
		this.#endRun();
	}

	changed(): void {
		this.#untidy = true;
	}

	message(ctx: ExtensionContext, text: string): void {
		this.settling = this.#queued(async (signal) => {
			const state = this.#keeper.state();
			const request = { state, trigger: "message" as const, news: text };
			const proposal = await propose(ctx.modelRegistry, this.#options.models(ctx), request, signal);
			if (proposal === undefined || signal.aborted) return;
			const entry = lastMessage(ctx.sessionManager.getBranch())?.entry;
			this.#keeper.settle(proposal, "message", { entry, covers: { from: entry, to: entry } });
		});
	}

	runStarted(): void {
		this.#working = true;
		this.#lastWork = Date.now();
	}

	turnEnded(ctx: ExtensionContext): void {
		const every = this.#options.interval() * 1000;
		if (!this.#working || every === 0 || this.#workTimer !== undefined) return;
		const wait = Math.max(0, this.#lastWork + every - Date.now());
		this.#workTimer = setTimeout(() => void this.#readWork(ctx), wait);
	}

	runEnded(ctx: ExtensionContext): void {
		this.#endRun();
		void this.#readWork(ctx).then(() => this.#tidy(ctx));
	}

	#endRun(): void {
		this.#working = false;
		clearTimeout(this.#workTimer);
		this.#workTimer = undefined;
	}

	#readWork(ctx: ExtensionContext): Promise<void> {
		clearTimeout(this.#workTimer);
		this.#workTimer = undefined;
		return this.#queued(async (signal) => {
			const branch = ctx.sessionManager.getBranch();
			const work = workSince(branch, this.#workReadTo);
			if (work.text === "") return;
			this.#workReadTo = work.to;
			this.#lastWork = Date.now();
			const state = this.#keeper.state();
			const asked = lastMessage(branch)?.text;
			const request = { state, trigger: "work" as const, news: work.text, asked };
			const proposal = await propose(ctx.modelRegistry, this.#options.models(ctx), request, signal);
			if (proposal === undefined || signal.aborted) return;
			this.#keeper.settle(proposal, "work", { entry: work.to, covers: coversOf(work) });
		});
	}

	#tidy(ctx: ExtensionContext): Promise<void> {
		return this.#queued(async (signal) => {
			if (!this.#untidy) return;
			this.#untidy = false;
			const session = sessionSince(ctx.sessionManager.getBranch(), this.#tidiedTo);
			const request = { state: this.#keeper.state(), session: session.text };
			const proposal = await tidy(ctx.modelRegistry, this.#options.models(ctx), request, signal);
			if (proposal === undefined || signal.aborted) return;
			this.#tidiedTo = session.to ?? this.#tidiedTo;
			this.#keeper.settle(proposal, "tidy", { entry: session.to, covers: coversOf(session) });
		});
	}

	/** One call at a time, each on the timeline the one before left; dropped when the session ends. */
	#queued(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
		const signal = this.#stop.signal;
		return this.#turns(() => task(signal), signal).catch(() => undefined);
	}
}

function coversOf(excerpt: Excerpt): GoalUpdate["covers"] {
	return { from: excerpt.from, to: excerpt.to };
}

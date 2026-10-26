// Pi's program status (working, blocked, done, error, idle), which pi reports only to the terminal,
// rebuilt from the same events with the same rules.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { defineContract, type EventScope } from "./contract.ts";
import { ASK, CANCEL } from "./contracts/ask.ts";
import { guarded, isObject } from "./decode.ts";

/** pi's program status words. `blocked` is a dialog waiting for the operator. */
export type SessionStatus = "working" | "blocked" | "done" | "error" | "idle";

/** How a run or a compaction left the session. */
type Ending = "done" | "error" | "idle";

const WORDS: ReadonlySet<string> = new Set<SessionStatus>([
	"working",
	"blocked",
	"done",
	"error",
	"idle",
]);

function isStatus(value: unknown): value is SessionStatus {
	return typeof value === "string" && WORDS.has(value);
}

export const SESSION_STATUS = defineContract<SessionStatus>(
	"session.status",
	guarded(isStatus, "a session status"),
);

/** Answered by the one follower of a process, so a second caller can tell it is not the first. */
const FOLLOWING = "harness:session.status:following";

/** How a compaction ended, as pi reports it. */
export interface CompactionEnd {
	/** `/compact`, as against a threshold or an overflow. */
	manual: boolean;
	/** Cancelled or stopped. */
	aborted: boolean;
	/** Failed for a reason other than an abort. */
	failed: boolean;
}

export class StatusTracker {
	#running = false;
	#compacting = false;
	/** How the run going on will end, as its latest response says. */
	#outcome: Ending = "done";
	/** The status while no run goes on. */
	#resting: Ending = "idle";
	/** pi's own dialogs open now: select, confirm, input, editor and custom. */
	#prompts = 0;
	/** The harness's questions open now, which a client may hold with no dialog on screen. */
	readonly #asks = new Set<string>();

	get status(): SessionStatus {
		if (this.#prompts > 0 || this.#asks.size > 0) return "blocked";
		if (this.#running || this.#compacting) return "working";
		return this.#resting;
	}

	runStarted(): void {
		this.#running = true;
		this.#outcome = "done";
	}

	/** The latest response decides how the run ends, so a retried error gives way to its retry. */
	responded(failed: boolean): void {
		this.#outcome = failed ? "error" : "done";
	}

	/** The run is over, with no retry or queued message left. An abort leaves it idle, as pi says. */
	settled(aborted: boolean): void {
		this.#running = false;
		this.#resting = aborted ? "idle" : this.#outcome;
	}

	compactionStarted(): void {
		this.#compacting = true;
	}

	/** A compaction with no run under it ends the session's turn: done or error if manual, idle if stopped. */
	compactionEnded(end: CompactionEnd): void {
		this.#compacting = false;
		if (this.#running) {
			if (end.aborted) this.#outcome = "idle";
			else if (end.failed) this.#outcome = "error";
		} else if (end.aborted) {
			this.#resting = "idle";
		} else if (end.manual) {
			this.#resting = end.failed ? "error" : "done";
		}
	}

	prompt(open: boolean): void {
		this.#prompts = Math.max(0, this.#prompts + (open ? 1 : -1));
	}

	/** Relies on the kit's client emitting `harness:ask.cancel` for every question it opened. */
	ask(id: string, open: boolean): void {
		if (open) this.#asks.add(id);
		else this.#asks.delete(id);
	}
}

/** Only the first caller on a bus follows. */
export function followSessionStatus(
	pi: ExtensionAPI,
	warn: (message: string) => void = () => {},
): void {
	const scope: EventScope = { events: pi.events, warn };
	const probe = { following: false };
	pi.events.emit(FOLLOWING, probe);
	if (probe.following) return;
	pi.events.on(FOLLOWING, (data) => {
		if (isObject(data)) data.following = true;
	});

	let tracker = new StatusTracker();
	let last = tracker.status;
	SESSION_STATUS.provide(scope, () => tracker.status);
	function after(change: (tracker: StatusTracker) => void): void {
		change(tracker);
		if (tracker.status === last) return;
		last = tracker.status;
		SESSION_STATUS.changed(scope, last);
	}

	function fresh(): void {
		tracker = new StatusTracker();
	}
	// Another session in this process starts afresh, as pi's reporter resets on a switch, and an
	// ended one says idle, so nobody reading the contract waits on a run that will never finish.
	pi.on("session_start", () => after(fresh));
	pi.on("session_shutdown", () => after(fresh));
	pi.on("agent_start", () => after((now) => now.runStarted()));
	pi.on("message_end", (event) => {
		const { message } = event;
		if (message.role !== "assistant") return;
		after((now) => now.responded("stopReason" in message && message.stopReason === "error"));
	});
	pi.on("agent_settled", (event) => after((now) => now.settled(event.aborted)));
	pi.on("session_before_compact", () => after((now) => now.compactionStarted()));
	pi.on("session_compact", (event) =>
		after((now) =>
			now.compactionEnded({ manual: event.reason === "manual", aborted: false, failed: false }),
		),
	);
	pi.on("session_compact_failed", (event) =>
		after((now) =>
			now.compactionEnded({
				manual: event.reason === "manual",
				aborted: event.aborted,
				failed: event.errorMessage !== undefined,
			}),
		),
	);
	pi.on("ui_prompt_start", () => after((now) => now.prompt(true)));
	pi.on("ui_prompt_end", () => after((now) => now.prompt(false)));
	pi.events.on(ASK, (data) => {
		if (isObject(data) && typeof data.id === "string")
			after((now) => now.ask(data.id as string, true));
	});
	pi.events.on(CANCEL, (data) => {
		if (isObject(data) && typeof data.id === "string")
			after((now) => now.ask(data.id as string, false));
	});
}

// Pi's program status (working, blocked, done, error, idle), which pi reports only to the terminal,
// rebuilt from the same events with the same rules.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { defineContract, type EventScope } from "./contract.ts";
import { ASK, CANCEL } from "./contracts/ask.ts";
import { guarded, isObject } from "./decode.ts";

/** `blocked` is a dialog waiting for the operator. */
export type SessionStatus = "working" | "blocked" | "done" | "error" | "idle";

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

/** Answered by the process's one follower, so a second caller knows it is not the first. */
const FOLLOWING = "harness:session.status:following";

export interface CompactionEnd {
	/** As against a threshold or an overflow. */
	manual: boolean;
	aborted: boolean;
	/** For a reason other than an abort. */
	failed: boolean;
}

export class StatusTracker {
	#running = false;
	#compacting = false;
	#outcome: Ending = "done";
	#resting: Ending = "idle";
	/** Select, confirm, input, editor and custom. */
	#prompts = 0;
	/** A client may hold one with no dialog on screen. */
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

	/** A retried error gives way to its retry. */
	responded(failed: boolean): void {
		this.#outcome = failed ? "error" : "done";
	}

	/** No retry or queued message left. An abort leaves it idle, as pi says. */
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
	// Another session in this process starts afresh, as pi's reporter does, and an ended one says idle.
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

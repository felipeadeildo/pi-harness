// What a session is doing, in the words of pi's program status protocol: working, blocked, done,
// error and idle. pi reports them to the terminal but not to extensions, so the kit follows the same
// events and answers the same words, for the bridge to publish and for a client to push on.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { defineContract, type EventScope } from "./contract.ts";
import { ASK, CANCEL } from "./contracts/ask.ts";
import { guarded, isObject } from "./decode.ts";

/** pi's program status words. `blocked` is a dialog waiting for the operator. */
export type SessionStatus = "working" | "blocked" | "done" | "error" | "idle";

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

/** How a turn ended, as pi reports it at `turn_end`. */
export type TurnOutcome = "completed" | "aborted" | "error";

/** Folds a session's events into its status. It holds no pi, so a test drives it directly. */
export class StatusTracker {
	#running = false;
	#compacting = false;
	/** pi's own dialogs open now: select, confirm, input, editor and custom. */
	#prompts = 0;
	/** The harness's questions open now, which a client may hold with no dialog on screen. */
	readonly #asks = new Set<string>();
	/** The last turn of the run ended in an error. */
	#failed = false;
	#ended: "done" | "error" | "idle" = "idle";

	get status(): SessionStatus {
		if (this.#prompts > 0 || this.#asks.size > 0) return "blocked";
		if (this.#running || this.#compacting) return "working";
		return this.#ended;
	}

	runStarted(): void {
		this.#running = true;
		this.#failed = false;
	}

	turnEnded(outcome: TurnOutcome): void {
		this.#failed = outcome === "error";
	}

	/** The run is over, with no retry or queued message left. An abort leaves it idle, as pi says. */
	settled(aborted: boolean): void {
		this.#running = false;
		if (aborted) this.#ended = "idle";
		else this.#ended = this.#failed ? "error" : "done";
	}

	compaction(running: boolean): void {
		this.#compacting = running;
	}

	prompt(open: boolean): void {
		this.#prompts = Math.max(0, this.#prompts + (open ? 1 : -1));
	}

	ask(id: string, open: boolean): void {
		if (open) this.#asks.add(id);
		else this.#asks.delete(id);
	}
}

/**
 * Follows this process's session and answers `SESSION_STATUS`, announcing each change. Only the
 * first caller in a process follows, so the bridge and any other feature can both call it.
 */
export function followSessionStatus(
	pi: ExtensionAPI,
	warn: (message: string) => void = () => {},
): void {
	const scope: EventScope = { events: pi.events, warn };
	if (SESSION_STATUS.current(scope) !== undefined) return;

	let tracker = new StatusTracker();
	let last = tracker.status;
	SESSION_STATUS.provide(scope, () => tracker.status);
	function after(change: (tracker: StatusTracker) => void): void {
		change(tracker);
		if (tracker.status === last) return;
		last = tracker.status;
		SESSION_STATUS.changed(scope, last);
	}

	pi.on("session_start", () =>
		after(() => {
			// A new or resumed session starts idle, with nothing open.
			tracker = new StatusTracker();
		}),
	);
	pi.on("agent_start", () => after((now) => now.runStarted()));
	pi.on("turn_end", (event) => after((now) => now.turnEnded(event.outcome)));
	pi.on("agent_settled", (event) => after((now) => now.settled(event.aborted)));
	pi.on("session_before_compact", () => after((now) => now.compaction(true)));
	pi.on("session_compact", () => after((now) => now.compaction(false)));
	pi.on("session_compact_failed", () => after((now) => now.compaction(false)));
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

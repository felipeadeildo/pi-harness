// The harness's facts as the bridge forwards them: what the kit logs for this session, sent as it is
// written, and the facts a snapshot carries to rebuild the same state in a client that just arrived.
import { isObject } from "@adeildo/pi-remote-protocol";

/**
 * The log's facts a client reduces. The bridge sends the session's own facts itself, and the log's
 * `session.state` is peers' running or idle, not pi's program status, so it never crosses.
 */
export const LOGGED_FACTS: ReadonlySet<string> = new Set([
	"tasks.changed",
	"ask.opened",
	"ask.closed",
	"call.ruled",
	"mode.changed",
	"prompt.received",
	"session.renamed",
]);

/** How many rulings a snapshot carries, the latest ones. A client reads older ones from the log. */
export const SNAPSHOT_RULINGS = 100;

export interface Fact {
	type: string;
	data: unknown;
}

export class HarnessFacts {
	/** The questions still open, by id, as they were asked. */
	readonly #asks = new Map<string, unknown>();
	/** The latest ruling of each call, the newest last. */
	readonly #rulings = new Map<string, unknown>();

	/** Keeps what a snapshot needs of a fact the session logged. */
	saw(type: string, data: unknown): void {
		if (!isObject(data)) return;
		if (type === "ask.opened" && typeof data.id === "string") this.#asks.set(data.id, data);
		else if (type === "ask.closed" && typeof data.id === "string") this.#asks.delete(data.id);
		else if (type === "call.ruled" && typeof data.toolCallId === "string") {
			this.#rulings.delete(data.toolCallId);
			this.#rulings.set(data.toolCallId, data);
			const oldest = this.#rulings.keys().next();
			if (this.#rulings.size > SNAPSHOT_RULINGS && oldest.done !== true) {
				this.#rulings.delete(oldest.value);
			}
		}
	}

	get openAsks(): string[] {
		return [...this.#asks.keys()];
	}

	/** The facts that rebuild the state as it stands: tasks, mode, open questions and latest rulings. */
	snapshot(tasks: unknown, mode: unknown): Fact[] {
		const facts: Fact[] = [];
		if (tasks !== undefined) facts.push({ type: "tasks.changed", data: { state: tasks } });
		if (mode !== undefined) facts.push({ type: "mode.changed", data: { mode } });
		for (const data of this.#asks.values()) facts.push({ type: "ask.opened", data });
		for (const data of this.#rulings.values()) facts.push({ type: "call.ruled", data });
		return facts;
	}
}

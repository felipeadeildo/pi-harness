// The commands a client sends to a session, run in the session's own process. Each one is answered on
// the envelope's id, and an id that already ran is answered as a repeat instead of running twice: the
// ids are kept in memory and read back from the log when the bridge starts, so a resend across a
// restart is a repeat too.
import type { By } from "@adeildo/pi-kit";
import type { Envelope } from "@adeildo/pi-remote-protocol";
import { isCommand } from "@adeildo/pi-remote-protocol";

/** How many ids a session remembers. A client that resends after this many others is on its own. */
export const KEPT_COMMANDS = 1_000;

/** What a command does to the session, as the bridge reaches it. Kept narrow so it can be faked. */
export interface CommandEffects {
	abort(): void;
	compact(instructions: string | undefined): void;
	rename(name: string): void;
	/** Closes open questions as a no, aborts the run and shuts the session down. */
	stop(force: boolean): void;
}

export interface CommandOptions {
	session: string;
	effects: CommandEffects;
	/** The ids this session already ran, newest last, read from its log when the bridge starts. */
	history?: readonly string[];
	/** Answers the command on its id. */
	answer(kind: "reply" | "error", type: string, data: Record<string, unknown>, id: string): void;
	/** Logs the command with who asked, before it runs, so a restart still knows the id. */
	received(id: string, command: string, by: By | undefined): void;
	/** Logs how a command ended, when it did not run: what the client shows as the reason. */
	outcome(id: string, command: string, by: By | undefined, outcome: "refused" | "failed"): void;
}

/**
 * A command the session does not run, with the reason a client shows. An effect throws it to refuse
 * something the command's shape allows, such as a forced stop that needs a runner.
 */
export class Refused extends Error {}

export class Commands {
	readonly #options: CommandOptions;
	/** The ids already run, oldest first. */
	readonly #ran: string[];

	constructor(options: CommandOptions) {
		this.#options = options;
		this.#ran = [...(options.history ?? [])].slice(-KEPT_COMMANDS);
	}

	/** Whether this id already ran, which makes the envelope a resend and not a second effect. */
	ran(id: string): boolean {
		return this.#ran.includes(id);
	}

	run(message: Envelope): void {
		const { id, type, by } = message;
		if (id === undefined) return;
		if (this.ran(id)) {
			this.#options.answer("reply", type, { repeat: true }, id);
			return;
		}
		if (!isCommand(type, message.data)) {
			this.#refuse(message, "the command is not one this session knows, or it lacks a field");
			return;
		}
		this.#remember(id);
		this.#options.received(id, type, by);
		try {
			this.#effect(type, message.data);
			this.#options.answer("reply", type, {}, id);
		} catch (error) {
			const reason = error instanceof Error ? error.message : "the command did not run";
			this.#options.outcome(id, type, by, error instanceof Refused ? "refused" : "failed");
			this.#options.answer("error", type, { reason }, id);
		}
	}

	#refuse(message: Envelope, reason: string): void {
		const { id, type, by } = message;
		if (id === undefined) return;
		this.#options.outcome(id, type, by, "refused");
		this.#options.answer("error", type, { reason }, id);
	}

	#remember(id: string): void {
		this.#ran.push(id);
		if (this.#ran.length > KEPT_COMMANDS) this.#ran.splice(0, this.#ran.length - KEPT_COMMANDS);
	}

	#effect(type: string, data: unknown): void {
		const fields = data as Record<string, unknown>;
		const { effects } = this.#options;
		switch (type) {
			case "run.abort":
				effects.abort();
				return;
			case "session.compact":
				effects.compact(typeof fields.instructions === "string" ? fields.instructions : undefined);
				return;
			case "session.rename":
				effects.rename(String(fields.name));
				return;
			case "session.stop":
				effects.stop(fields.force === true);
				return;
			default:
				// `prompt.send`, `queue.clear`, `ask.answer` and the rest come with their own slices: a
				// client hears "not yet" instead of a command that seems to work and does nothing.
				throw new Refused(`${type} is not served by this session yet`);
		}
	}
}

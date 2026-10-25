// The commands a client sends to a session, run in the session's own process. Each one is answered on
// the envelope's id, and an id that already ran is answered as a repeat instead of running twice: the
// ids are kept in memory and read back from the log when the bridge starts, so a resend across a
// restart is a repeat too.
import type { By, Letter } from "@adeildo/pi-kit";
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
	/** Switches the model, and answers only once it did or refused to. */
	setModel(provider: string, id: string): Promise<void>;
	setThinking(level: string): void;
	setMode(mode: string, by: By | undefined): void;
	/** Answers a question a client is looking at, and refuses one that is no longer open. */
	answerAsk(fields: Record<string, unknown>, by: By | undefined): void;
	/** Puts a prompt in the session's inbox: a steer goes in at once, a follow-up waits for the settle. */
	prompt(id: string, by: By | undefined, text: string, deliverAs: Letter["want"]): void;
	/** Takes back what the inbox holds, which is what pi's Esc does with its queue. */
	clearQueue(ids?: readonly string[]): Letter[];
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

/** The ids a `queue.clear` names, when it names any: absent means "the whole queue". */
function idsOf(fields: Record<string, unknown>): string[] | undefined {
	if (!Array.isArray(fields.ids)) return undefined;
	return fields.ids.filter((id): id is string => typeof id === "string");
}

export class Commands {
	readonly #options: CommandOptions;
	/** The ids already run, oldest first. */
	readonly #ran: string[];
	/** The commands waiting to run, so their effects land in the order the client sent them. */
	#pending: Promise<void> = Promise.resolve();

	constructor(options: CommandOptions) {
		this.#options = options;
		this.#ran = [...(options.history ?? [])].slice(-KEPT_COMMANDS);
	}

	/** Whether this id already ran, which makes the envelope a resend and not a second effect. */
	ran(id: string): boolean {
		return this.#ran.includes(id);
	}

	/**
	 * Runs one command and answers it. The id is checked and remembered before it runs, so a resend
	 * right behind a slow one is a repeat; the effects themselves run one at a time, in the order the
	 * client sent them, so two commands never land out of order.
	 */
	run(message: Envelope): Promise<void> {
		const { id, type, by } = message;
		if (id === undefined) return Promise.resolve();
		if (this.ran(id)) {
			this.#options.answer("reply", type, { repeat: true }, id);
			return Promise.resolve();
		}
		if (!isCommand(type, message.data)) {
			this.#refuse(message, "the command is not one this session knows, or it lacks a field");
			return Promise.resolve();
		}
		this.#remember(id);
		this.#options.received(id, type, by);
		// A reply that cannot go out, or a log that throws, must not leave the next command unanswered:
		// the chain carries the failure and goes on with the one behind it.
		this.#pending = this.#pending.then(
			() => this.#execute(message),
			() => this.#execute(message),
		);
		return this.#pending;
	}

	async #execute(message: Envelope): Promise<void> {
		const { id, type, by } = message;
		if (id === undefined) return;
		try {
			const data = await this.#effect(type, message.data, by, id);
			this.#options.answer("reply", type, data, id);
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

	/** Runs the effect and returns what a client reads in the reply, which is `{}` for most. */
	async #effect(
		type: string,
		data: unknown,
		by: By | undefined,
		id: string,
	): Promise<Record<string, unknown>> {
		const fields = data as Record<string, unknown>;
		const { effects } = this.#options;
		switch (type) {
			case "run.abort":
				effects.abort();
				return {};
			case "session.compact":
				effects.compact(typeof fields.instructions === "string" ? fields.instructions : undefined);
				return {};
			case "session.rename":
				effects.rename(String(fields.name));
				return {};
			case "session.stop":
				effects.stop(fields.force === true);
				return {};
			case "model.set":
				await effects.setModel(String(fields.provider), String(fields.id));
				return {};
			case "thinking.set":
				effects.setThinking(String(fields.level));
				return {};
			case "mode.set":
				effects.setMode(String(fields.mode), by);
				return {};
			case "ask.answer":
				effects.answerAsk(fields, by);
				return {};
			case "prompt.send": {
				const deliverAs =
					fields.deliverAs === "steer" || fields.deliverAs === "followUp"
						? fields.deliverAs
						: "followUp";
				effects.prompt(id, by, String(fields.text), deliverAs);
				return {};
			}
			case "queue.clear":
				// What was taken back is the answer, so a client draws the queue it now holds.
				return { taken: effects.clearQueue(idsOf(fields)) };
			default:
				// A command of a type this session does not serve yet: the client hears "not yet"
				// instead of a command that seems to work and does nothing.
				throw new Refused(`${type} is not served by this session yet`);
		}
	}
}

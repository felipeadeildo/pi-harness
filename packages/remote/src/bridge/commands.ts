// A client's commands, run in the session's process and answered on the envelope's id. An id that
// already ran, here or in the log before a restart, is answered as a repeat.
import type { By, Letter } from "@adeildo/pi-kit";
import type { Envelope } from "@adeildo/pi-remote-protocol";
import { isCommand } from "@adeildo/pi-remote-protocol";

/** A client that resends after this many others is on its own. */
export const KEPT_COMMANDS = 1_000;

export interface CommandEffects {
	abort(): void;
	compact(instructions: string | undefined): void;
	rename(name: string): void;
	stop(force: boolean): void;
	setModel(provider: string, id: string): Promise<void>;
	setThinking(level: string): void;
	setMode(mode: string, by: By | undefined): void;
	answerAsk(fields: Record<string, unknown>, by: By | undefined): void;
	prompt(id: string, by: By | undefined, text: string, deliverAs: Letter["want"]): void;
	clearQueue(ids?: readonly string[]): Letter[];
}

export interface CommandOptions {
	session: string;
	effects: CommandEffects;
	/** Read from the log when the bridge starts. */
	history?: readonly string[];
	answer(kind: "reply" | "error", type: string, data: Record<string, unknown>, id: string): void;
	/** Logged before it runs, so a restart still knows the id. */
	received(id: string, command: string, by: By | undefined): void;
	/** Only when it did not run. */
	outcome(id: string, command: string, by: By | undefined, outcome: "refused" | "failed"): void;
}

export class Refused extends Error {}

function idsOf(fields: Record<string, unknown>): string[] | undefined {
	if (!Array.isArray(fields.ids)) return undefined;
	return fields.ids.filter((id): id is string => typeof id === "string");
}

export class Commands {
	readonly #options: CommandOptions;
	readonly #ran: string[];
	/** Effects land in the order the client sent them. */
	#pending: Promise<void> = Promise.resolve();

	constructor(options: CommandOptions) {
		this.#options = options;
		this.#ran = [...(options.history ?? [])].slice(-KEPT_COMMANDS);
	}

	ran(id: string): boolean {
		return this.#ran.includes(id);
	}

	/** Remembers the id before running, so a resend behind a slow command is a repeat. Effects run in order. */
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
		// A failed reply or log must not leave the next command unanswered.
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
				return { taken: effects.clearQueue(idsOf(fields)) };
			default:
				// Refused rather than seeming to work and doing nothing.
				throw new Refused(`${type} is not served by this session yet`);
		}
	}
}

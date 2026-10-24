// What the operator typed while the daemon was out of reach. A command keeps the time it was typed,
// because that is what decides whether it still goes on its own after a reconnect: the last two
// minutes go out in order, and anything older waits for the person to send, edit or drop it.
import type { CommandType } from "@adeildo/pi-remote-protocol";

/** How long a command typed offline still goes out by itself, once the daemon answers again. */
export const GOES_ALONE = 2 * 60_000;

export type CommandState = "waiting" | "sent" | "applied" | "refused";

/** One command, from the moment it was typed to the moment its reply arrived. */
export interface Outgoing {
	/** The id the reply will carry, so a resent command is a repeat instead of a second effect. */
	id: string;
	type: CommandType;
	data: unknown;
	/** When the operator typed it, which is not when it goes out. */
	at: number;
	state: CommandState;
	/** Why it was refused, when it was. */
	why?: string;
}

export interface OutboxOptions {
	/** The clock, so a test does not wait two minutes. */
	now?: () => number;
	/** The id maker, so a test can read the ids it expects. */
	id?: () => string;
	/** How long a waiting command still goes out alone. */
	window?: number;
}

/** The commands that have not reached the session yet, in the order they were typed. */
export class Outbox {
	readonly #now: () => number;
	readonly #newId: () => string;
	readonly #window: number;
	readonly #commands: Outgoing[] = [];
	#made = 0;

	constructor(options: OutboxOptions = {}) {
		this.#now = options.now ?? Date.now;
		this.#newId = options.id ?? (() => `cmd:${++this.#made}:${this.#now()}`);
		this.#window = options.window ?? GOES_ALONE;
	}

	/** A command the operator typed. It waits until the connection takes it. */
	add(type: CommandType, data: unknown): Outgoing {
		const command: Outgoing = { id: this.#newId(), type, data, at: this.#now(), state: "waiting" };
		this.#commands.push(command);
		return command;
	}

	/** Every command still held, in the order they were typed. */
	all(): Outgoing[] {
		return [...this.#commands];
	}

	/** What can go out now: waiting, and typed inside the window. */
	ready(at = this.#now()): Outgoing[] {
		return this.#commands.filter(
			(command) => command.state === "waiting" && at - command.at <= this.#window,
		);
	}

	/** What waited too long: it goes only when the person sends, edits or drops it. */
	held(at = this.#now()): Outgoing[] {
		return this.#commands.filter(
			(command) => command.state === "waiting" && at - command.at > this.#window,
		);
	}

	/** The connection took it. A reply is what moves it further. */
	sent(id: string): void {
		this.#move(id, "sent");
	}

	/** The session applied it, which is the end of the road. */
	applied(id: string): void {
		const command = this.#find(id);
		if (command === undefined) return;
		command.state = "applied";
		this.#forget();
	}

	/** The session refused it, and the reason is what the screen shows. */
	refused(id: string, why: string): void {
		const command = this.#find(id);
		if (command === undefined) return;
		command.state = "refused";
		command.why = why;
	}

	/** The person dropped it, or sent it although it had waited too long. */
	drop(id: string): boolean {
		const at = this.#commands.findIndex((command) => command.id === id);
		if (at === -1) return false;
		this.#commands.splice(at, 1);
		return true;
	}

	#find(id: string): Outgoing | undefined {
		return this.#commands.find((command) => command.id === id);
	}

	#move(id: string, state: CommandState): void {
		const command = this.#find(id);
		if (command !== undefined) command.state = state;
	}

	/** An applied command is no longer news; the reply already told the screen. */
	#forget(): void {
		const applied = this.#commands.filter((command) => command.state === "applied");
		for (const command of applied) this.drop(command.id);
	}
}

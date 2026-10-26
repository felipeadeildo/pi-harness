// Who has a session open, and whose input came last. It holds no socket and decides nothing in time, so
// it is testable without a network; what the daemon does with a change is not this module's business.
import type { By, Viewer } from "@adeildo/pi-remote-protocol";

export type Connection = string;

const TERMINAL = "terminal";

export interface PresenceOf {
	viewers: Viewer[];
	active?: By;
}

export class Presence {
	readonly #watching = new Map<string, Connection[]>();
	readonly #by = new Map<Connection, By>();
	readonly #latest = new Map<string, Connection>();
	readonly #terminal = new Map<string, By>();
	readonly #announced = new Map<string, string>();
	#listen: ((session: string, presence: PresenceOf) => void) | undefined;

	onChange(listen: (session: string, presence: PresenceOf) => void): void {
		this.#listen = listen;
	}

	/** A client can watch a session whose bridge is not registered yet: after a restart it comes first. */
	watch(session: string, connection: Connection): void {
		const watching = this.#watching.get(session);
		if (watching === undefined) this.#watching.set(session, [connection]);
		else if (!watching.includes(connection)) watching.push(connection);
		this.#announce(session);
	}

	/** What it claimed does not outlive its watching, so the maps drop it. */
	leave(session: string, connection: Connection): void {
		const watching = this.#watching.get(session);
		if (watching === undefined) return;
		const at = watching.indexOf(connection);
		if (at === -1) return;
		watching.splice(at, 1);
		// A session nobody watches leaves no entry, whether it ended or never came.
		if (watching.length === 0) this.#watching.delete(session);
		// Not what clears the mark: `of` only marks a connection still watching. This is so the maps
		// do not keep a name nobody can see.
		if (this.#latest.get(session) === connection) this.#latest.delete(session);
		if (![...this.#watching.values()].some((one) => one.includes(connection))) {
			this.#by.delete(connection);
		}
		this.#announce(session);
	}

	/** Opening a session is not typing in it: the input mark stays with whoever typed last. */
	name(session: string, connection: Connection, by: By): void {
		if (this.#watching.get(session)?.includes(connection) !== true) return;
		this.#by.set(connection, by);
		this.#announce(session);
	}

	/** A connection typed: it is a viewer under that name, and it has the latest input. */
	input(session: string, connection: Connection, by: By): void {
		if (this.#watching.get(session)?.includes(connection) !== true) return;
		this.#by.set(connection, by);
		this.#latest.set(session, connection);
		this.#announce(session);
	}

	/** A connection closed: it leaves every session it watched, and each one is announced once. */
	drop(connection: Connection): void {
		for (const session of this.#watching.keys()) this.leave(session, connection);
		this.#by.delete(connection);
	}

	typed(session: string, by: By): void {
		this.#terminal.set(session, by);
		this.#latest.set(session, TERMINAL);
		this.#announce(session);
	}

	/** The viewers of a session and the one whose input came last. */
	of(session: string): PresenceOf {
		const viewers: Viewer[] = [];
		let active: By | undefined;
		const terminal = this.#terminal.get(session);
		if (terminal !== undefined) viewers.push({ name: terminal.name, machine: terminal.machine });
		for (const connection of this.#watching.get(session) ?? []) {
			const by = this.#by.get(connection);
			if (by === undefined) continue;
			if (!viewers.some((one) => one.name === by.name && one.machine === by.machine)) {
				viewers.push({ name: by.name, machine: by.machine });
			}
			if (this.#latest.get(session) === connection) active = by;
		}
		if (this.#latest.get(session) === TERMINAL && terminal !== undefined) active = terminal;
		return active === undefined ? { viewers } : { viewers, active };
	}

	/** The connections watching a session, so whoever owns the sockets can send to them. */
	connections(session: string): Connection[] {
		return [...(this.#watching.get(session) ?? [])];
	}

	forget(session: string): void {
		const watching = this.#watching.get(session) ?? [];
		this.#watching.delete(session);
		this.#latest.delete(session);
		this.#terminal.delete(session);
		this.#announced.delete(session);
		for (const connection of watching) {
			if (![...this.#watching.values()].some((one) => one.includes(connection))) {
				this.#by.delete(connection);
			}
		}
	}

	/** How many connections watch each session, which is what the daemon reports as its clients. */
	counts(): Map<string, number> {
		return new Map([...this.#watching].map(([session, watching]) => [session, watching.length]));
	}

	/** Two changes that leave a session looking the same are one event. */
	#announce(session: string): void {
		const presence = this.of(session);
		// Nobody to name is nothing to say, and a watcher that named nobody changed nothing.
		if (presence.viewers.length === 0) {
			this.#announced.delete(session);
			return;
		}
		const said = JSON.stringify(presence);
		if (this.#announced.get(session) === said) return;
		this.#announced.set(session, said);
		this.#listen?.(session, presence);
	}
}

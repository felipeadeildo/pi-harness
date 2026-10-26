// Who has a session open and whose input came last. No sockets, so it tests without a network.
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

	/** After a restart a client may come before its session's bridge. */
	watch(session: string, connection: Connection): void {
		const watching = this.#watching.get(session);
		if (watching === undefined) this.#watching.set(session, [connection]);
		else if (!watching.includes(connection)) watching.push(connection);
		this.#announce(session);
	}

	leave(session: string, connection: Connection): void {
		const watching = this.#watching.get(session);
		if (watching === undefined) return;
		const at = watching.indexOf(connection);
		if (at === -1) return;
		watching.splice(at, 1);
		if (watching.length === 0) this.#watching.delete(session);
		// Only so the maps do not keep a name nobody can see; `of` marks only connections still watching.
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

	input(session: string, connection: Connection, by: By): void {
		if (this.#watching.get(session)?.includes(connection) !== true) return;
		this.#by.set(connection, by);
		this.#latest.set(session, connection);
		this.#announce(session);
	}

	drop(connection: Connection): void {
		for (const session of this.#watching.keys()) this.leave(session, connection);
		this.#by.delete(connection);
	}

	typed(session: string, by: By): void {
		this.#terminal.set(session, by);
		this.#latest.set(session, TERMINAL);
		this.#announce(session);
	}

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

	counts(): Map<string, number> {
		return new Map([...this.#watching].map(([session, watching]) => [session, watching.length]));
	}

	/** Two changes that leave a session looking the same are one event. */
	#announce(session: string): void {
		const presence = this.of(session);
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

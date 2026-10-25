// The daemon's side of a client's socket: a client says hello for each session it opens, with the
// cursor it stopped at, and gets what it missed. Then every event of the session follows as the
// bridge sends it, and its own commands come back to it alone.
import { type By, envelope, type Envelope, isBy, isObject } from "@adeildo/pi-remote-protocol";

import { envelopeOf } from "../wire/lines.ts";
import type { WebSocket } from "../wire/websocket.ts";
import { type Connection, Presence, type PresenceOf } from "./presence.ts";
import type { Sessions } from "./sessions.ts";

/** A client with this much unsent is too slow to keep up, and is closed to reconnect from its cursor. */
export const CLIENT_BACKLOG = 8 * 1024 * 1024;

export interface HubOptions {
	sessions: Sessions;
	/** Asks a session's bridge for a snapshot. False when no bridge of the session is connected. */
	askSnapshot: (session: string) => boolean;
	/**
	 * Passes a client's command to the session's bridge. False when no bridge is connected, and then
	 * the client hears why on the command's id instead of waiting for an answer that never comes.
	 */
	command: (session: string, message: Envelope) => boolean;
	warn?: (message: string) => void;
}

/**
 * The sockets of this daemon, and what each one watches. It knows no server and no request: the
 * lifecycle hands it a socket and the events, which is what lets it be tested without a port.
 */
export class Hub {
	readonly #options: HubOptions;
	/** Who has each session open, and whose input came last. It holds no socket of its own. */
	readonly #presence = new Presence();
	/** The sockets of this daemon, by the connection id the presence knows them by. */
	readonly #sockets = new Map<Connection, WebSocket>();
	/** How many connections have been opened, which is the id each one gets. */
	#opened = 0;
	/** Who asked for each command in flight, by session and id, so the answer goes back to it alone. */
	readonly #asked = new Map<string, Connection>();

	constructor(options: HubOptions) {
		this.#options = options;
		this.#presence.onChange((session, presence) => this.#announce(session, presence));
	}

	/** Takes a socket the server accepted, and answers with what to call for its messages and its end. */
	open(ws: WebSocket): { message: (text: string) => void; closed: () => void } {
		this.#opened += 1;
		const connection = `c${this.#opened}`;
		this.#sockets.set(connection, ws);
		return {
			message: (text) => {
				const message = envelopeOf(text);
				if (message?.kind === "hello") this.#hello(connection, ws, message);
				else if (message?.kind === "command") this.#command(connection, ws, message);
			},
			closed: () => {
				this.#sockets.delete(connection);
				// What it claimed does not outlive it: the marks it held go with the connection.
				this.#presence.drop(connection);
				// Its commands will never be answered, so nothing keeps a place for them.
				for (const [wasAsked, asker] of this.#asked) {
					if (asker === connection) this.#asked.delete(wasAsked);
				}
			},
		};
	}

	/** Ends every connection, which the daemon's shutdown does before the server closes. */
	close(): void {
		for (const ws of this.#sockets.values()) ws.close(1001);
	}

	/** The sessions some client watches, each with how many. */
	watched(): Map<string, number> {
		return this.#presence.counts();
	}

	/** Sends an event of a session to every client watching it. */
	forward(message: Envelope): void {
		const watchers = this.#watchers(message.session ?? "");
		if (watchers.length === 0) return;
		const out = message.type === "state" ? this.#withPresence(message) : message;
		for (const ws of watchers) this.#send(ws, out);
	}

	/**
	 * The session ended, so nothing of its presence is kept, and no command of it waits for an answer
	 * that will never come.
	 */
	forget(session: string): void {
		this.#presence.forget(session);
		for (const [wasAsked] of this.#asked) {
			if (wasAsked.startsWith(`${session}\n`)) this.#asked.delete(wasAsked);
		}
	}

	/**
	 * The terminal of a session typed, so it is one of the session's viewers and the one with the last
	 * input. The bridge says who it is; the daemon does not guess a handle it cannot see.
	 */
	typed(session: string, by: By): void {
		this.#presence.typed(session, by);
	}

	/** A bridge's answer to a command, to the client that asked, and to nobody else. */
	answer(message: Envelope): void {
		const wasAsked = `${message.session ?? ""}\n${message.id ?? ""}`;
		const asked = this.#asked.get(wasAsked);
		const ws = asked === undefined ? undefined : this.#sockets.get(asked);
		if (ws === undefined) return;
		this.#asked.delete(wasAsked);
		this.#send(ws, message);
	}

	/**
	 * A client opens a session. Only the live part of its cursor, `(epoch, seq)`, is read here: the
	 * `entry` and the state it also keeps are for the session file and the log. A cursor this life of
	 * the session can resume from gets the events after it. Anything else, no cursor, another epoch or
	 * a gap, gets the snapshot and what came after it, and when the daemon has none to give, the bridge
	 * is asked and its answer follows.
	 */
	#hello(connection: Connection, ws: WebSocket, message: Envelope): void {
		const session = message.session ?? "";
		const sessions = this.#options.sessions;
		// The client watches the session even before a bridge registers it: after a daemon restarts,
		// a client can come back before the bridge does, and the bridge's first snapshot is its answer.
		this.#presence.watch(session, connection);
		const by = byOf(message.data);
		if (by !== undefined) this.#presence.name(session, connection, by);
		if (sessions.get(session) === undefined) {
			// Not an end: the client keeps watching, and the bridge's first snapshot reaches it.
			this.#send(ws, envelope("error", "hello", { reason: "waiting for the session", session }));
			return;
		}

		const cursor = cursorOf(message.data);
		const missed = cursor === undefined ? undefined : sessions.after(session, cursor);
		const catchUp = missed ?? sessions.opening(session);
		if (catchUp !== undefined) {
			for (const event of catchUp) this.#send(ws, event);
			return;
		}
		if (!this.#options.askSnapshot(session))
			this.#send(ws, envelope("error", "hello", { reason: "no snapshot yet", session }));
	}

	/**
	 * A client's command goes to the session's own process, and its answer comes back to this client
	 * only: another window watching the same session sees the effect, not the answer.
	 */
	#command(connection: Connection, ws: WebSocket, message: Envelope): void {
		const session = message.session ?? "";
		const id = message.id;
		if (id === undefined) {
			this.#send(
				ws,
				envelope("error", message.type, { reason: "a command needs an id" }, { session }),
			);
			return;
		}
		// A command is input, so the client that sent it is the one the session answers now.
		const by = message.by;
		// A command is an act: whoever sent it is watching with that name, and has the latest input.
		if (by !== undefined) this.#presence.input(session, connection, by);
		const wasAsked = `${session}\n${id}`;
		// An id already in flight is refused here, so the client that asked first keeps its answer:
		// taking its place would leave that one waiting for a reply delivered to another window.
		if (this.#asked.has(wasAsked)) {
			this.#send(
				ws,
				envelope(
					"error",
					message.type,
					{ reason: "a command with that id is already in flight" },
					{ session, id },
				),
			);
			return;
		}
		this.#asked.set(wasAsked, connection);
		if (this.#options.command(session, message)) return;
		this.#asked.delete(wasAsked);
		this.#send(
			ws,
			envelope(
				"error",
				message.type,
				{ reason: "no session is connected to answer this" },
				{ session, id },
			),
		);
	}

	/** A snapshot with who has the session open, which the daemon knows and the bridge does not. */
	#withPresence(message: Envelope): Envelope {
		// The snapshot is already folded by the bridge; a client adds who is watching, which is the
		// daemon's to know and never travels in the session's own state.
		if (!isObject(message.data) || !isObject(message.data.snapshot)) return message;
		const snapshot = { ...message.data.snapshot, ...this.#presence.of(message.session ?? "") };
		return { ...message, data: { ...message.data, snapshot } };
	}

	/** The sockets watching a session, which is who an event of it goes to. */
	#watchers(session: string): WebSocket[] {
		return this.#presence
			.connections(session)
			.flatMap((connection) => this.#sockets.get(connection) ?? []);
	}

	/** Sends a changed presence to everyone watching that session, including whoever caused it. */
	#announce(session: string, presence: PresenceOf): void {
		for (const ws of this.#watchers(session)) {
			this.#send(ws, envelope("event", "presence.changed", presence, { session }));
		}
	}

	#send(ws: WebSocket, message: Envelope): void {
		if (ws.pending() > CLIENT_BACKLOG) {
			this.#options.warn?.("a client fell too far behind and was closed");
			ws.close(1013);
			return;
		}
		ws.send(JSON.stringify(message));
	}
}

/** Who a client says it is, from the hello that opens its stream. */
function byOf(data: unknown): By | undefined {
	const by = isObject(data) ? data.by : undefined;
	return isBy(by) ? by : undefined;
}

/** The live part of a client's cursor, when it has one. */
function cursorOf(data: unknown): { epoch: string; seq: number } | undefined {
	const cursor = isObject(data) ? data.cursor : undefined;
	if (!isObject(cursor)) return undefined;
	const { epoch, seq } = cursor;
	return typeof epoch === "string" && typeof seq === "number" ? { epoch, seq } : undefined;
}

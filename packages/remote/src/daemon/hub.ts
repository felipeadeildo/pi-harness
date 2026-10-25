// The daemon's side of a client's socket: a hello per session, then every event of it, and a command
// answered to its sender alone.
import { type By, envelope, type Envelope, isBy, isObject } from "@adeildo/pi-remote-protocol";

import { envelopeOf } from "../wire/lines.ts";
import type { WebSocket } from "../wire/websocket.ts";
import { type Connection, Presence, type PresenceOf } from "./presence.ts";
import type { Sessions } from "./sessions.ts";

/** A client this far behind is closed, to come back from its cursor. */
export const CLIENT_BACKLOG = 8 * 1024 * 1024;

export interface HubOptions {
	sessions: Sessions;
	/** False when no bridge is connected, and the client hears why on the command's id. */
	command: (session: string, message: Envelope) => boolean;
	warn?: (message: string) => void;
}

/** The sockets of this daemon and what each watches, with no server and no request. */
export class Hub {
	readonly #options: HubOptions;
	/** Who has each session open, and whose input came last. */
	readonly #presence = new Presence();
	/** By the connection id the presence knows them by. */
	readonly #sockets = new Map<Connection, WebSocket>();
	/** The id each connection gets. */
	#opened = 0;
	/** Who asked for each command in flight, by session and id. */
	readonly #asked = new Map<string, Connection>();

	constructor(options: HubOptions) {
		this.#options = options;
		this.#presence.onChange((session, presence) => this.#announce(session, presence));
	}

	/** Takes a socket the server accepted. */
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
				// What it claimed does not outlive it.
				this.#presence.drop(connection);
				// Nothing keeps a place for commands that will never be answered.
				for (const [wasAsked, asker] of this.#asked) {
					if (asker === connection) this.#asked.delete(wasAsked);
				}
			},
		};
	}

	/** The daemon's shutdown calls this before the server closes. */
	close(): void {
		for (const ws of this.#sockets.values()) ws.close(1001);
	}

	/** Each session some client watches, with how many. */
	watched(): Map<string, number> {
		return this.#presence.counts();
	}

	/** Sends an event to every client watching its session. */
	forward(message: Envelope): void {
		const watchers = this.#watchers(message.session ?? "");
		if (watchers.length === 0) return;
		const out = message.type === "state" ? this.#withPresence(message) : message;
		for (const ws of watchers) this.#send(ws, out);
	}

	/** The session ended: no presence of it is kept and no command of it waits. */
	forget(session: string): number {
		const watching = this.#presence.counts().get(session) ?? 0;
		this.#presence.forget(session);
		for (const [wasAsked] of this.#asked) {
			if (wasAsked.startsWith(`${session}\n`)) this.#asked.delete(wasAsked);
		}
		return watching;
	}

	/** The terminal typed, so it watches and has the latest input. The bridge says who it is. */
	typed(session: string, by: By): void {
		this.#presence.typed(session, by);
	}

	/** A bridge's answer, to the client that asked. */
	answer(message: Envelope): void {
		const wasAsked = `${message.session ?? ""}\n${message.id ?? ""}`;
		const asked = this.#asked.get(wasAsked);
		const ws = asked === undefined ? undefined : this.#sockets.get(asked);
		if (ws === undefined) return;
		this.#asked.delete(wasAsked);
		this.#send(ws, message);
	}

	/**
	 * A client opens a session. Only `(epoch, seq)` is read from its cursor: a cursor this life can
	 * resume from gets the events after it, and anything else gets the opening.
	 */
	#hello(connection: Connection, ws: WebSocket, message: Envelope): void {
		const session = message.session ?? "";
		const sessions = this.#options.sessions;
		// It watches before a bridge registers it: a client can come back after a restart before the bridge does.
		this.#presence.watch(session, connection);
		const by = byOf(message.data);
		if (by !== undefined) this.#presence.name(session, connection, by);
		// With no bridge registered there is nothing to answer with, and the client keeps watching.
		if (sessions.get(session) === undefined) return;

		const cursor = cursorOf(message.data);
		const missed = cursor === undefined ? undefined : sessions.after(session, cursor);
		const catchUp = missed ?? sessions.opening(session);
		if (catchUp !== undefined) {
			for (const event of catchUp) this.#send(ws, event);
			return;
		}
	}

	/** A command goes to the session's process, and its answer to this client alone. */
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
		// A command is input, so its sender is the one the session answers now.
		const by = message.by;
		// Whoever sends one watches with that name, and has the latest input.
		if (by !== undefined) this.#presence.input(session, connection, by);
		const wasAsked = `${session}\n${id}`;
		// An id already in flight is refused, so the client that asked first keeps its answer.
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

	/** The opening with who has the session open, which only the daemon knows. */
	#withPresence(message: Envelope): Envelope {
		// The bridge folded the state; who watches is the daemon's to know and never travels in it.
		if (!isObject(message.data) || !isObject(message.data.summary)) return message;
		const summary = { ...message.data.summary, ...this.#presence.of(message.session ?? "") };
		return { ...message, data: { ...message.data, summary } };
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

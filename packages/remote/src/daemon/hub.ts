// A client's socket: a hello per session, then its events; a command is answered to its sender alone.
import { type By, envelope, type Envelope, isBy, isObject } from "@adeildo/pi-remote-protocol";

import { envelopeOf } from "../wire/lines.ts";
import type { WebSocket } from "../wire/websocket.ts";
import { type Connection, Presence, type PresenceOf } from "./presence.ts";
import type { Sessions } from "./sessions.ts";

/** A client this far behind is closed, to come back from its cursor. */
const CLIENT_BACKLOG = 8 * 1024 * 1024;

export interface HubOptions {
	sessions: Sessions;
	command: (session: string, message: Envelope) => boolean;
	warn?: (message: string) => void;
}

export class Hub {
	readonly #options: HubOptions;
	readonly #presence = new Presence();
	readonly #sockets = new Map<Connection, WebSocket>();
	#opened = 0;
	readonly #asked = new Map<string, Connection>();

	constructor(options: HubOptions) {
		this.#options = options;
		this.#presence.onChange((session, presence) => this.#announce(session, presence));
	}

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
				this.#presence.drop(connection);
				for (const [wasAsked, asker] of this.#asked) {
					if (asker === connection) this.#asked.delete(wasAsked);
				}
			},
		};
	}

	close(): void {
		for (const ws of this.#sockets.values()) ws.close(1001);
	}

	watched(): Map<string, number> {
		return this.#presence.counts();
	}

	forward(message: Envelope): void {
		const watchers = this.#watchers(message.session ?? "");
		if (watchers.length === 0) return;
		const out = message.type === "state" ? this.#withPresence(message) : message;
		for (const ws of watchers) this.#send(ws, out);
	}

	forget(session: string): number {
		const watching = this.#presence.counts().get(session) ?? 0;
		this.#presence.forget(session);
		for (const [wasAsked] of this.#asked) {
			if (wasAsked.startsWith(`${session}\n`)) this.#asked.delete(wasAsked);
		}
		return watching;
	}

	typed(session: string, by: By): void {
		this.#presence.typed(session, by);
	}

	answer(message: Envelope): void {
		const wasAsked = `${message.session ?? ""}\n${message.id ?? ""}`;
		const asked = this.#asked.get(wasAsked);
		const ws = asked === undefined ? undefined : this.#sockets.get(asked);
		if (ws === undefined) return;
		this.#asked.delete(wasAsked);
		this.#send(ws, message);
	}

	/** A cursor this epoch can resume from gets the events after it; anything else gets the opening. */
	#hello(connection: Connection, ws: WebSocket, message: Envelope): void {
		const session = message.session ?? "";
		const sessions = this.#options.sessions;
		// A client can come back after a restart before the bridge does.
		this.#presence.watch(session, connection);
		const by = byOf(message.data);
		if (by !== undefined) this.#presence.name(session, connection, by);
		if (sessions.get(session) === undefined) return;

		const cursor = cursorOf(message.data);
		const missed = cursor === undefined ? undefined : sessions.after(session, cursor);
		const catchUp = missed ?? sessions.opening(session);
		if (catchUp !== undefined) {
			for (const event of catchUp) this.#send(ws, event);
			return;
		}
	}

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
		const by = message.by;
		if (by !== undefined) this.#presence.input(session, connection, by);
		const wasAsked = `${session}\n${id}`;
		// The client that asked first keeps its answer.
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

	#withPresence(message: Envelope): Envelope {
		// Who watches is the daemon's to know and never travels in the bridge's state.
		if (!isObject(message.data) || !isObject(message.data.summary)) return message;
		const summary = { ...message.data.summary, ...this.#presence.of(message.session ?? "") };
		return { ...message, data: { ...message.data, summary } };
	}

	#watchers(session: string): WebSocket[] {
		return this.#presence
			.connections(session)
			.flatMap((connection) => this.#sockets.get(connection) ?? []);
	}

	#announce(session: string, presence: PresenceOf): void {
		for (const ws of this.#watchers(session)) {
			this.#send(ws, envelope("event", "presence.changed", presence, { session }));
		}
	}

	#send(ws: WebSocket, message: Envelope): void {
		if (ws.bufferedAmount > CLIENT_BACKLOG) {
			this.#options.warn?.("a client fell too far behind and was closed");
			ws.close(1013);
			return;
		}
		ws.send(JSON.stringify(message));
	}
}

function byOf(data: unknown): By | undefined {
	const by = isObject(data) ? data.by : undefined;
	return isBy(by) ? by : undefined;
}

function cursorOf(data: unknown): { epoch: string; seq: number } | undefined {
	const cursor = isObject(data) ? data.cursor : undefined;
	if (!isObject(cursor)) return undefined;
	const { epoch, seq } = cursor;
	return typeof epoch === "string" && typeof seq === "number" ? { epoch, seq } : undefined;
}

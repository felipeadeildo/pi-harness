// The daemon's side for clients: a few HTTP routes and one WebSocket per client. A client says hello
// for each session it opens, with the cursor it stopped at, and gets what it missed: the events
// after its cursor, or the last snapshot and the events after it. Then every event of the session
// follows as the bridge sends it.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { envelope, type Envelope, isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { envelopeOf } from "../wire/lines.ts";
import { accept, type WebSocket } from "../wire/websocket.ts";
import { type Asking, checkPlace, loopbackHosts } from "./auth.ts";
import type { Sessions } from "./sessions.ts";

/** A client with this much unsent is too slow to keep up, and is closed to reconnect from its cursor. */
export const CLIENT_BACKLOG = 8 * 1024 * 1024;

export interface ClientsOptions {
	sessions: Sessions;
	version: string;
	/** Asks a session's bridge for a snapshot. False when no bridge of the session is connected. */
	askSnapshot: (session: string) => boolean;
	warn?: (message: string) => void;
	now?: () => number;
}

export class Clients {
	readonly #options: ClientsOptions;
	readonly #server: Server;
	readonly #started: number;
	/** Each session's clients, which every event of the session goes to. */
	readonly #watchers = new Map<string, Set<WebSocket>>();
	readonly #sockets = new Set<WebSocket>();
	/** The names this daemon answers to, once it knows its port. Nothing answers before. */
	#hosts: ReadonlySet<string> = new Set();

	constructor(options: ClientsOptions) {
		this.#options = options;
		this.#started = (options.now ?? Date.now)();
		this.#server = createServer((request, response) => this.#route(request, response));
		this.#server.on("upgrade", (request: IncomingMessage, socket, head: Buffer) => {
			// Any page can open a WebSocket to 127.0.0.1, so one from another Origin is refused here.
			const placed = checkPlace(asking(request, true), this.#hosts);
			if (!placed.ok) {
				socket.end(`HTTP/1.1 ${placed.status} ${placed.reason}\r\nConnection: close\r\n\r\n`);
				return;
			}
			if (new URL(request.url ?? "/", "http://daemon").pathname !== "/ws") {
				socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
				return;
			}
			if (head.length > 0) socket.unshift(head);
			accept(request, socket, (ws) => this.#open(ws));
		});
	}

	/** Listens on `host:port`, and resolves the port it got, which tells a test where `0` landed. */
	listen(port: number, host = "127.0.0.1"): Promise<number | undefined> {
		return new Promise((resolve) => {
			this.#server.once("error", () => resolve(undefined));
			this.#server.listen(port, host, () => {
				const bound = (this.#server.address() as AddressInfo).port;
				this.#hosts = loopbackHosts(bound);
				resolve(bound);
			});
		});
	}

	close(): void {
		for (const ws of this.#sockets) ws.close(1001);
		this.#server.close();
	}

	/** Sends an event of a session to every client watching it. */
	forward(message: Envelope): void {
		const watchers = this.#watchers.get(message.session ?? "");
		if (watchers === undefined) return;
		const out = message.type === "snapshot" ? this.#options.sessions.withFacts(message) : message;
		for (const ws of watchers) this.#send(ws, out);
	}

	#open(ws: WebSocket): { message: (text: string) => void; closed: () => void } {
		this.#sockets.add(ws);
		return {
			message: (text) => {
				const message = envelopeOf(text);
				if (message?.kind === "hello") this.#hello(ws, message);
			},
			closed: () => {
				this.#sockets.delete(ws);
				for (const watchers of this.#watchers.values()) watchers.delete(ws);
			},
		};
	}

	/**
	 * A client opens a session. Only the live part of its cursor, `(epoch, seq)`, is read here: the
	 * `entry` and the facts it also keeps are for the session file and the log. A cursor this life of
	 * the session can resume from gets the events after it. Anything else, no cursor, another epoch or a gap, gets the snapshot and what came
	 * after it, and when the daemon has none to give, the bridge is asked and its answer follows.
	 */
	#hello(ws: WebSocket, message: Envelope): void {
		const session = message.session ?? "";
		const sessions = this.#options.sessions;
		if (sessions.get(session) === undefined) {
			this.#send(ws, envelope("error", "hello", { reason: "unknown session", session }));
			return;
		}
		let watchers = this.#watchers.get(session);
		if (watchers === undefined) this.#watchers.set(session, (watchers = new Set()));
		watchers.add(ws);

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

	#send(ws: WebSocket, message: Envelope): void {
		if (ws.pending() > CLIENT_BACKLOG) {
			this.#options.warn?.("a client fell too far behind and was closed");
			ws.close(1013);
			return;
		}
		ws.send(JSON.stringify(message));
	}

	#route(request: IncomingMessage, response: ServerResponse): void {
		// A page that resolved its own name to 127.0.0.1 is same-origin with the daemon, so the Host
		// is checked before anything is read.
		const placed = checkPlace(asking(request, false), this.#hosts);
		if (!placed.ok) return reply(response, placed.status, { error: placed.reason });
		const path = new URL(request.url ?? "/", "http://daemon").pathname;
		if (request.method !== "GET") return reply(response, 405, { error: "GET only" });
		if (path === "/health") {
			const uptime = (this.#options.now ?? Date.now)() - this.#started;
			return reply(response, 200, { version: this.#options.version, protocol: PROTOCOL, uptime });
		}
		if (path === "/sessions") return reply(response, 200, this.#list());
		const snapshot = /^\/sessions\/([^/]+)\/([^/]+)\/snapshot$/.exec(path);
		if (snapshot !== null) {
			const [machine, session] = snapshot.slice(1).map(decoded);
			if (machine === undefined || session === undefined)
				return reply(response, 400, { error: "a machine and a session, percent-encoded" });
			const known = this.#options.sessions.get(session);
			const opening =
				known?.machine === machine ? this.#options.sessions.opening(session) : undefined;
			if (opening === undefined) return reply(response, 404, { error: "no snapshot" });
			return reply(response, 200, opening[0]);
		}
		reply(response, 404, { error: "not found" });
	}

	/** The session list: who each session is and how it is doing, without its entries. */
	#list(): unknown[] {
		return this.#options.sessions.list().map((one) => ({
			machine: one.machine,
			session: one.session,
			epoch: one.epoch,
			connected: one.connected,
			...(one.gone === undefined ? {} : { gone: one.gone }),
			live: one.live,
			...(one.snapshot === undefined ? {} : { snapshot: one.snapshot.snapshot }),
			facts: one.facts,
		}));
	}
}

/** What `checkPlace` reads of a request. */
function asking(request: IncomingMessage, upgrade: boolean): Asking {
	const header = (name: string) => {
		const value = request.headers[name];
		return Array.isArray(value) ? value[0] : value;
	};
	return {
		method: request.method ?? "GET",
		path: new URL(request.url ?? "/", "http://daemon").pathname,
		host: header("host"),
		origin: header("origin"),
		cookie: undefined,
		upgrade,
	};
}

/** A path segment as written, or undefined for an encoding that does not decode. */
function decoded(part: string): string | undefined {
	try {
		return decodeURIComponent(part);
	} catch {
		return undefined;
	}
}

function reply(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	response.end(JSON.stringify(body));
}

/** The live part of a client's cursor, when it has one. */
function cursorOf(data: unknown): { epoch: string; seq: number } | undefined {
	const cursor = isObject(data) ? data.cursor : undefined;
	if (!isObject(cursor)) return undefined;
	const { epoch, seq } = cursor;
	return typeof epoch === "string" && typeof seq === "number" ? { epoch, seq } : undefined;
}

// The daemon's side for clients: a few HTTP routes and one WebSocket per client. A client says hello
// for each session it opens, with the cursor it stopped at, and gets what it missed: the events
// after its cursor, or the last snapshot and the events after it. Then every event of the session
// follows as the bridge sends it.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
	type By,
	envelope,
	type Envelope,
	isBy,
	isObject,
	PROTOCOL,
} from "@adeildo/pi-remote-protocol";

import { envelopeOf } from "../wire/lines.ts";
import { accept, type WebSocket } from "../wire/websocket.ts";
import { isAppFile, serveApp, type WebApp } from "./app.ts";
import { type Asking, authorize, type Logins, loginCookie, loopbackHosts } from "./auth.ts";
import { History, PAGE } from "./history.ts";
import { type Connection, Presence, type PresenceOf } from "./presence.ts";
import type { Sessions } from "./sessions.ts";

const STATUS = { 401: "Unauthorized", 403: "Forbidden", 421: "Misdirected Request" } as const;

/** A client with this much unsent is too slow to keep up, and is closed to reconnect from its cursor. */
export const CLIENT_BACKLOG = 8 * 1024 * 1024;
/** The most a login request may carry: one token in a small JSON object. */
const LOGIN_BYTES = 4_096;

export interface ClientsOptions {
	sessions: Sessions;
	logins: Logins;
	version: string;
	/** Asks a session's bridge for a snapshot. False when no bridge of the session is connected. */
	askSnapshot: (session: string) => boolean;
	/**
	 * Passes a client's command to the session's bridge. False when no bridge is connected, and then
	 * the client hears why on the command's id instead of waiting for an answer that never comes.
	 */
	command: (session: string, message: Envelope) => boolean;
	/**
	 * The web app, answered for every path the data routes leave. Its files are the only paths a
	 * browser loads before it holds a login. None in a daemon built without it.
	 */
	web?: WebApp;
	warn?: (message: string) => void;
	now?: () => number;
}

export class Clients {
	readonly #options: ClientsOptions;
	readonly #server: Server;
	readonly #started: number;
	/** Who has each session open, and whose input came last. It holds no socket of its own. */
	readonly #presence = new Presence();
	/** The sockets of this daemon, by the connection id the presence knows them by. */
	readonly #sockets = new Map<Connection, WebSocket>();
	/** How many connections have been opened, which is the id each one gets. */
	#opened = 0;
	readonly #history = new History();
	/** Who asked for each command in flight, by session and id, so the answer goes back to it alone. */
	readonly #asked = new Map<string, Connection>();
	/** The names this daemon answers to, once it knows its port. Nothing answers before. */
	#hosts: ReadonlySet<string> = new Set();

	constructor(options: ClientsOptions) {
		this.#options = options;
		this.#presence.onChange((session, presence) => this.#announce(session, presence));
		this.#started = (options.now ?? Date.now)();
		this.#server = createServer((request, response) => this.#route(request, response));
		this.#server.on("upgrade", (request: IncomingMessage, socket, head: Buffer) => {
			// Any page can open a WebSocket to 127.0.0.1, so one from another Origin is refused here,
			// and one with no login too.
			const verdict = authorize(asking(request, true), this.#place());
			if (!verdict.ok) {
				// A fixed reason phrase: the request's own Origin or Host never goes into the head.
				socket.end(
					`HTTP/1.1 ${verdict.status} ${STATUS[verdict.status]}\r\nConnection: close\r\n\r\n`,
				);
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
		for (const ws of this.#sockets.values()) ws.close(1001);
		this.#server.close();
	}

	/** The sessions some client watches, each with how many. */
	watched(): Map<string, number> {
		return this.#presence.counts();
	}

	/** Sends an event of a session to every client watching it. */
	forward(message: Envelope): void {
		const watchers = this.#watchers(message.session ?? "");
		if (watchers.length === 0) return;
		const out = message.type === "snapshot" ? this.#withPresence(message) : message;
		for (const ws of watchers) this.#send(ws, out);
	}

	#open(ws: WebSocket): { message: (text: string) => void; closed: () => void } {
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

	/**
	 * A client opens a session. Only the live part of its cursor, `(epoch, seq)`, is read here: the
	 * `entry` and the facts it also keeps are for the session file and the log. A cursor this life of
	 * the session can resume from gets the events after it. Anything else, no cursor, another epoch or a gap, gets the snapshot and what came
	 * after it, and when the daemon has none to give, the bridge is asked and its answer follows.
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

	/**
	 * The session ended, so nothing of its presence is kept: a relaunch under the same id would
	 * otherwise start with the terminal of the session before it, and a name a rename has moved on.
	 */
	forget(session: string): void {
		this.#presence.forget(session);
		// A command in flight for a session that ended will never be answered either.
		for (const [wasAsked] of this.#asked) {
			if (wasAsked.startsWith(`${session}\n`)) this.#asked.delete(wasAsked);
		}
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

	#send(ws: WebSocket, message: Envelope): void {
		if (ws.pending() > CLIENT_BACKLOG) {
			this.#options.warn?.("a client fell too far behind and was closed");
			ws.close(1013);
			return;
		}
		ws.send(JSON.stringify(message));
	}

	/** What `authorize` checks a request against. */
	#place(): { hosts: ReadonlySet<string>; logins: Logins; isAppFile(path: string): boolean } {
		const web = this.#options.web;
		return {
			hosts: this.#hosts,
			logins: this.#options.logins,
			// A route is answered as a route even when the build happens to hold a page of that name,
			// which `isAppFile` would find for `/sessions` in a `sessions.html`.
			isAppFile: (path) => web !== undefined && !isRoute(path) && isAppFile(web, path),
		};
	}

	#route(request: IncomingMessage, response: ServerResponse): void {
		// A page that resolved its own name to 127.0.0.1 is same-origin with the daemon, so the Host
		// is checked before anything is read, and then the login.
		const verdict = authorize(asking(request, false), this.#place());
		if (!verdict.ok) return reply(response, verdict.status, { error: verdict.reason });
		const url = new URL(request.url ?? "/", "http://daemon");
		const path = url.pathname;
		if (request.method === "POST" && path === "/login") {
			this.#login(request, response);
			return;
		}
		if (request.method !== "GET") return reply(response, 405, { error: "GET only" });
		if (path === "/health") {
			const uptime = (this.#options.now ?? Date.now)() - this.#started;
			return reply(response, 200, { version: this.#options.version, protocol: PROTOCOL, uptime });
		}
		if (path === "/sessions") return reply(response, 200, this.#list());
		const route = /^\/sessions\/([^/]+)\/([^/]+)\/(snapshot|entries)$/.exec(path);
		if (route !== null) {
			const [machine, session] = route.slice(1, 3).map(decoded);
			if (machine === undefined || session === undefined)
				return reply(response, 400, { error: "a machine and a session, percent-encoded" });
			const known = this.#options.sessions.get(session);
			if (known?.machine !== machine) return reply(response, 404, { error: "no such session" });
			if (route[3] === "entries") {
				void this.#entries(response, known.live.file, session, url).catch(() =>
					reply(response, 500, { error: "the session file could not be read" }),
				);
				return;
			}
			const opening = this.#options.sessions.opening(session);
			if (opening === undefined) return reply(response, 404, { error: "no snapshot" });
			return reply(response, 200, opening[0]);
		}
		// The app comes after every data route, so a file named like a route can never answer for it.
		const web = this.#options.web;
		if (web === undefined) return reply(response, 404, { error: "not found" });
		const served = serveApp(web, path);
		response.writeHead(served.status, { "content-type": served.type, ...served.headers });
		response.end(served.body);
	}

	/** A page of the session's entries, read from its file: before an entry, since one, or the tail. */
	async #entries(
		response: ServerResponse,
		file: string | undefined,
		session: string,
		url: URL,
	): Promise<void> {
		// Only a `pi --no-session` has no file at all, and it holds no older entries either.
		if (file === undefined) return reply(response, 200, { entries: [], more: false });
		const query = url.searchParams;
		const limit = Number(query.get("limit") ?? PAGE);
		const page = await this.#history.page(file, session, {
			...(query.has("before") ? { before: query.get("before") ?? "" } : {}),
			...(query.has("since") ? { since: query.get("since") ?? "" } : {}),
			limit: Number.isFinite(limit) ? limit : PAGE,
		});
		if ("foreign" in page) return reply(response, 404, { error: "not this session's file" });
		// 410: the client's cursor is gone from the file, so it drops what it holds and starts over.
		if ("unknown" in page)
			return reply(response, 410, { error: "unknown entry", entry: page.unknown });
		reply(response, 200, page);
	}

	/**
	 * Trades the token in the body for a login cookie. The token never travels in the query, which
	 * access logs keep, and a used, unknown or late one gets nothing.
	 */
	#login(request: IncomingMessage, response: ServerResponse): void {
		let body = "";
		let cut = false;
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			if (cut) return;
			if (body.length + chunk.length > LOGIN_BYTES) {
				// A body past one token is no login, and it is cut here instead of held in memory.
				cut = true;
				body = "";
				response.once("finish", () => request.destroy());
				response.writeHead(413, {
					"content-type": "application/json",
					"cache-control": "no-store",
					connection: "close",
				});
				response.end(JSON.stringify({ error: "a login carries one token" }));
				return;
			}
			body += chunk;
		});
		request.on("end", () => {
			if (cut) return;
			const token = tokenOf(body);
			const cookie = token === undefined ? undefined : this.#options.logins.exchange(token);
			if (cookie === undefined) {
				return reply(response, 401, {
					error: "this link was used, is unknown or is late: ask pi for a new one with /remote",
				});
			}
			response.writeHead(204, {
				// Loopback is plain HTTP, where a Secure cookie would never come back. When F3 reaches
				// the daemon through TLS, this follows the scheme the request came in on.
				"set-cookie": loginCookie(cookie, false),
				"cache-control": "no-store",
			});
			response.end();
		});
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

/** The daemon's own routes, which no file of the web build can stand in for. */
function isRoute(path: string): boolean {
	return (
		path === "/ws" ||
		path === "/health" ||
		path === "/login" ||
		path === "/logout" ||
		path === "/sessions" ||
		path.startsWith("/sessions/") ||
		path.startsWith("/.well-known/")
	);
}

/** The token in a login request's JSON body. */
function tokenOf(body: string): string | undefined {
	try {
		const value: unknown = JSON.parse(body);
		return isObject(value) && typeof value.token === "string" ? value.token : undefined;
	} catch {
		return undefined;
	}
}

/** What `authorize` reads of a request. */
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
		cookie: header("cookie"),
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

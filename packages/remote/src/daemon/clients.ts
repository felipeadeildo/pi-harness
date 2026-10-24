// The daemon's side for clients: a few HTTP routes and one WebSocket per client. A client says hello
// for each session it opens, with the cursor it stopped at, and gets what it missed: the events
// after its cursor, or the last snapshot and the events after it. Then every event of the session
// follows as the bridge sends it.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { envelope, type Envelope, isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { envelopeOf } from "../wire/lines.ts";
import { accept, type WebSocket } from "../wire/websocket.ts";
import { type Asking, authorize, type Logins, loginCookie, loopbackHosts } from "./auth.ts";
import { History, PAGE } from "./history.ts";
import type { Sessions } from "./sessions.ts";

const STATUS = { 401: "Unauthorized", 403: "Forbidden", 421: "Misdirected Request" } as const;

/** A client with this much unsent is too slow to keep up, and is closed to reconnect from its cursor. */
export const CLIENT_BACKLOG = 8 * 1024 * 1024;
/** The most a login request may carry: one token in a small JSON object. */
const LOGIN_BYTES = 4_096;

export interface ClientsOptions {
	sessions: Sessions;
	logins: Logins;
	/**
	 * The paths of the files the web build exported, which a browser loads before it holds a login.
	 * Empty until the daemon serves the build.
	 */
	appFiles?: ReadonlySet<string>;
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
	readonly #history = new History();
	/** The names this daemon answers to, once it knows its port. Nothing answers before. */
	#hosts: ReadonlySet<string> = new Set();

	constructor(options: ClientsOptions) {
		this.#options = options;
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
		for (const ws of this.#sockets) ws.close(1001);
		this.#server.close();
	}

	/** The sessions some client watches, each with how many. */
	watched(): Map<string, number> {
		return new Map([...this.#watchers].map(([session, watchers]) => [session, watchers.size]));
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
				for (const [session, watchers] of this.#watchers) {
					watchers.delete(ws);
					// A session nobody watches leaves no entry, whether it ended or never came.
					if (watchers.size === 0) this.#watchers.delete(session);
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
	#hello(ws: WebSocket, message: Envelope): void {
		const session = message.session ?? "";
		const sessions = this.#options.sessions;
		// The client watches the session even before a bridge registers it: after a daemon restarts,
		// a client can come back before the bridge does, and the bridge's first snapshot is its answer.
		let watchers = this.#watchers.get(session);
		if (watchers === undefined) this.#watchers.set(session, (watchers = new Set()));
		watchers.add(ws);
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
		const files = this.#options.appFiles ?? new Set<string>();
		return {
			hosts: this.#hosts,
			logins: this.#options.logins,
			// A route is answered as a route even when the build happens to hold a file of that name.
			isAppFile: (path) => !isRoute(path) && files.has(path),
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
		reply(response, 404, { error: "not found" });
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

/** The live part of a client's cursor, when it has one. */
function cursorOf(data: unknown): { epoch: string; seq: number } | undefined {
	const cursor = isObject(data) ? data.cursor : undefined;
	if (!isObject(cursor)) return undefined;
	const { epoch, seq } = cursor;
	return typeof epoch === "string" && typeof seq === "number" ? { epoch, seq } : undefined;
}

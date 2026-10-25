// The daemon's own HTTP routes: health, the session list, a session's opening and pages, the login
// that trades a token for a cookie, and the web app for everything the data routes leave.
import type { IncomingMessage, ServerResponse } from "node:http";

import { isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { isAppFile, serveApp, type WebApp } from "./app.ts";
import { type Asking, authorize, type Logins, loginCookie } from "./auth.ts";
import { History, PAGE } from "./history.ts";
import type { Sessions } from "./sessions.ts";

export const STATUS = {
	401: "Unauthorized",
	403: "Forbidden",
	421: "Misdirected Request",
} as const;

/** The most a login request may carry: one token in a small JSON object. */
const LOGIN_BYTES = 4_096;

export interface RoutesOptions {
	sessions: Sessions;
	logins: Logins;
	version: string;
	/** The names this daemon answers to, once the port is known. Nothing answers before. */
	hosts: () => ReadonlySet<string>;
	/** When the daemon started, for `/health`. */
	started: number;
	/**
	 * The web app, answered for every path the data routes leave. Its files are the only paths a
	 * browser loads before it holds a login. None in a daemon built without it.
	 */
	web?: WebApp;
	now?: () => number;
}

/** The pages and the data both come through here; the socket and the port are the lifecycle's. */
export class Routes {
	readonly #options: RoutesOptions;
	readonly #history = new History();

	constructor(options: RoutesOptions) {
		this.#options = options;
	}

	/** Answers one request, or hands it to the app when it is a page. */
	handle(request: IncomingMessage, response: ServerResponse): void {
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
			const uptime = (this.#options.now ?? Date.now)() - this.#options.started;
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

	/**
	 * The session ended, so the index of its paged file goes with it: a relaunch under the same id
	 * would otherwise page through what the session before it wrote.
	 */
	forget(session: string): void {
		const file = this.#options.sessions.get(session)?.live.file;
		if (file !== undefined) this.#history.forget(file);
	}

	/** What `authorize` checks a request against. */
	#place(): { hosts: ReadonlySet<string>; logins: Logins; isAppFile(path: string): boolean } {
		const web = this.#options.web;
		return {
			hosts: this.#options.hosts(),
			logins: this.#options.logins,
			// A route is answered as a route even when the build happens to hold a page of that name,
			// which `isAppFile` would find for `/sessions` in a `sessions.html`.
			isAppFile: (path) => web !== undefined && !isRoute(path) && isAppFile(web, path),
		};
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
			state: one.state,
		}));
	}
}

/** The daemon's own routes, which no file of the web build can stand in for. */
export function isRoute(path: string): boolean {
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
export function asking(request: IncomingMessage, upgrade: boolean): Asking {
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

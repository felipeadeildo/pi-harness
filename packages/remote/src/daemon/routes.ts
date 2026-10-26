// The daemon's own HTTP routes: health, the session list, a session's opening and pages, the login
// that trades a token for a cookie, and the web app for everything the data routes leave. A device of
// the machine's owner that comes through the tailnet logs in by who it is, with no token. The list
// holds the sessions of the owner's other machines too, and a session of another machine is read from
// its daemon, so a client needs one address for all of them.
import type { IncomingMessage, ServerResponse } from "node:http";

import { isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { isAppFile, serveApp, type WebApp } from "./app.ts";
import { type Asking, authorize, cookieOf, type Logins, loginCookie } from "./auth.ts";
import { History, PAGE } from "./history.ts";
import type { Machine, Machines } from "./machines.ts";
import type { Sessions } from "./sessions.ts";
import type { Owners } from "./tailnet.ts";

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
	/** This machine's name, as its sessions carry it. */
	machine: string;
	/** The owner's other machines on the tailnet, whose sessions the list holds too. */
	machines?: Machines;
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
	/** The machine's tailnet address, and who owns the devices that reach it. */
	tailnet?: { ip: string; owners: Owners };
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
			const { version, machine } = this.#options;
			return reply(response, 200, { version, protocol: PROTOCOL, machine, uptime });
		}
		if (path === "/sessions") {
			// `here` is how another daemon asks, so two machines never ask each other in a circle.
			if (url.searchParams.has("here")) return reply(response, 200, this.#list());
			void this.#everywhere().then((list) => reply(response, 200, list));
			return;
		}
		const route = /^\/sessions\/([^/]+)\/([^/]+)\/(opening|entries)$/.exec(path);
		if (route !== null) {
			const [machine, session] = route.slice(1, 3).map(decoded);
			if (machine === undefined || session === undefined)
				return reply(response, 400, { error: "a machine and a session, percent-encoded" });
			const elsewhere = this.#options.machines?.named(machine);
			if (elsewhere !== undefined) {
				void this.#relay(response, elsewhere, `${path}${url.search}`);
				return;
			}
			const known = this.#options.sessions.get(session);
			if (known?.machine !== machine) return reply(response, 404, { error: "no such session" });
			if (route[3] === "entries") {
				void this.#entries(response, known.live.file, session, url).catch(() =>
					reply(response, 500, { error: "the session file could not be read" }),
				);
				return;
			}
			const opening = this.#options.sessions.opening(session);
			if (opening === undefined) return reply(response, 404, { error: "no opening" });
			return reply(response, 200, opening[0]);
		}
		// The app comes after every data route, so a file named like a route can never answer for it.
		const web = this.#options.web;
		if (web === undefined) return reply(response, 404, { error: "not found" });
		const served = serveApp(web, path);
		const write = (cookie?: string): void => {
			response.writeHead(served.status, {
				"content-type": served.type,
				...served.headers,
				...(cookie === undefined ? {} : { "set-cookie": loginCookie(cookie, false) }),
			});
			response.end(served.body);
		};
		// A page asked for over the tailnet with no login: the owner's own device gets one with the page.
		const needsLogin =
			served.type.startsWith("text/html") &&
			!this.#options.logins.has(cookieOf(request.headers.cookie));
		if (!needsLogin) return write();
		void this.#ownerLogin(request).then(write, () => write());
	}

	/**
	 * A login for a device that came through the tailnet and belongs to the user who owns this machine.
	 * Nothing for any other request: one on loopback, a device another user shares into the tailnet, or
	 * a `whois` that failed or was slow.
	 */
	async #ownerLogin(request: IncomingMessage): Promise<string | undefined> {
		const tailnet = this.#options.tailnet;
		if (tailnet === undefined) return undefined;
		if (plainAddress(request.socket.localAddress) !== tailnet.ip) return undefined;
		const from = plainAddress(request.socket.remoteAddress);
		if (from === undefined || !(await tailnet.owners.owns(from))) return undefined;
		return this.#options.logins.grant();
	}

	/**
	 * The session ended, so the index of its paged file goes with it: a relaunch under the same id
	 * would otherwise page through what the session before it wrote.
	 */
	forget(session: string): string | undefined {
		const file = this.#options.sessions.get(session)?.live.file;
		if (file !== undefined) this.#history.forget(file);
		return file;
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
			void (
				token === undefined
					? this.#ownerLogin(request)
					: Promise.resolve(this.#options.logins.exchange(token))
			).then((cookie) => this.#loggedIn(response, cookie));
		});
	}

	#loggedIn(response: ServerResponse, cookie: string | undefined): void {
		if (cookie === undefined) {
			return reply(response, 401, {
				error: "this link was used, is unknown or is late: ask pi for a new one with /remote",
			});
		}
		response.writeHead(204, {
			// Loopback and the tailnet are plain HTTP, where a Secure cookie would never come back. A
			// daemon reached through TLS follows the scheme the request came in on.
			"set-cookie": loginCookie(cookie, false),
			"cache-control": "no-store",
		});
		response.end();
	}

	/**
	 * This machine's sessions, then each other machine's. A machine that does not answer in time is
	 * left out of this read, and the next one asks it again.
	 */
	async #everywhere(): Promise<unknown[]> {
		const machines = this.#options.machines;
		const theirs = await Promise.all(
			(machines?.list() ?? []).map(async (machine) => {
				try {
					const answer = await machines?.get(machine, "/sessions?here");
					const list: unknown = await answer?.json();
					return Array.isArray(list) ? list : [];
				} catch {
					return [];
				}
			}),
		);
		return [...this.#list(), ...theirs.flat()];
	}

	/** A request for another machine's session, answered by that machine's daemon. */
	async #relay(response: ServerResponse, machine: Machine, path: string): Promise<void> {
		try {
			const answer = await this.#options.machines?.get(machine, path);
			if (answer === undefined) return reply(response, 502, { error: "no machine to ask" });
			response.writeHead(answer.status, {
				"content-type": answer.headers.get("content-type") ?? "application/json",
				"cache-control": "no-store",
			});
			response.end(Buffer.from(await answer.arrayBuffer()));
		} catch {
			reply(response, 502, { error: `${machine.name} did not answer` });
		}
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
			...(one.opening === undefined ? {} : { summary: one.opening.summary }),
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

/** An address as the tailnet names it: Node gives an IPv4 peer on a dual-stack socket as `::ffff:a.b.c.d`. */
function plainAddress(address: string | undefined): string | undefined {
	return address?.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

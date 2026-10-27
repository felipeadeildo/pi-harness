// The daemon's HTTP routes. The session list includes the owner's other machines, and their
// sessions are read from their daemons, so a client needs one address.
import type { IncomingMessage, ServerResponse } from "node:http";

import { isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { isAppFile, serveApp, type WebApp } from "./app.ts";
import { type Asking, authorize, cookieOf, type Logins, loginCookie } from "./auth.ts";
import { History, PAGE } from "./history.ts";
import type { Machine, Machines } from "./machines.ts";
import { roomBytes, sharedHere } from "./mirror.ts";
import type { Sessions } from "./sessions.ts";
import type { Owners } from "./tailnet.ts";

export const STATUS = {
	401: "Unauthorized",
	403: "Forbidden",
	421: "Misdirected Request",
} as const;

const LOGIN_BYTES = 4_096;

export interface RoutesOptions {
	sessions: Sessions;
	logins: Logins;
	version: string;
	machine: string;
	machines?: Machines;
	events?: string;
	/** Nothing answers before the port is known. */
	hosts: () => ReadonlySet<string>;
	started: number;
	/** The only paths a browser loads before it holds a login. */
	web?: WebApp;
	now?: () => number;
	tailnet?: { ip: string; owners: Owners };
}

export class Routes {
	readonly #options: RoutesOptions;
	readonly #history = new History();

	constructor(options: RoutesOptions) {
		this.#options = options;
	}

	handle(request: IncomingMessage, response: ServerResponse): void {
		// A page that resolved its own name to 127.0.0.1 is same-origin, so Host is checked first.
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
		if (path === "/tailnet") return reply(response, 200, this.#machinesList());
		if (path === "/sessions") {
			// `here` is how another daemon asks, so two machines never ask each other in a circle.
			if (url.searchParams.has("here")) return reply(response, 200, this.#list());
			void this.#everywhere().then((list) => reply(response, 200, list));
			return;
		}
		const events = this.#options.events;
		if (path === "/shared" && events !== undefined)
			return reply(response, 200, sharedHere(events, this.#options.machine));
		const log = /^\/rooms\/([^/]+)\/([^/]+)$/.exec(path);
		if (log !== null && events !== undefined) {
			const bytes = roomBytes(
				events,
				log[1] ?? "",
				log[2] ?? "",
				Number(url.searchParams.get("from")) || 0,
			);
			if (bytes === undefined) return reply(response, 404, { error: "no such log" });
			response.writeHead(200, {
				"content-type": "application/octet-stream",
				"cache-control": "no-store",
			});
			response.end(bytes);
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
		// After every data route, so a file named like a route can never answer for it.
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
		// The owner's own device on the tailnet gets a login with the page.
		const needsLogin =
			served.type.startsWith("text/html") &&
			!this.#options.logins.has(cookieOf(request.headers.cookie));
		if (!needsLogin) return write();
		void this.#ownerLogin(request).then(write, () => write());
	}

	/** Only for a tailnet device of this machine's owner; any doubt, including a slow `whois`, is a no. */
	async #ownerLogin(request: IncomingMessage): Promise<string | undefined> {
		const tailnet = this.#options.tailnet;
		if (tailnet === undefined) return undefined;
		if (plainAddress(request.socket.localAddress) !== tailnet.ip) return undefined;
		const from = plainAddress(request.socket.remoteAddress);
		if (from === undefined || !(await tailnet.owners.owns(from))) return undefined;
		return this.#options.logins.grant();
	}

	forget(session: string): string | undefined {
		const file = this.#options.sessions.get(session)?.live.file;
		if (file !== undefined) this.#history.forget(file);
		return file;
	}

	#place(): { hosts: ReadonlySet<string>; logins: Logins; isAppFile(path: string): boolean } {
		const web = this.#options.web;
		return {
			hosts: this.#options.hosts(),
			logins: this.#options.logins,
			isAppFile: (path) => web !== undefined && !isRoute(path) && isAppFile(web, path),
		};
	}

	async #entries(
		response: ServerResponse,
		file: string | undefined,
		session: string,
		url: URL,
	): Promise<void> {
		// Only `pi --no-session` has no file.
		if (file === undefined) return reply(response, 200, { entries: [], more: false });
		const query = url.searchParams;
		const limit = Number(query.get("limit") ?? PAGE);
		const page = await this.#history.page(file, session, {
			...(query.has("before") ? { before: query.get("before") ?? "" } : {}),
			...(query.has("since") ? { since: query.get("since") ?? "" } : {}),
			limit: Number.isFinite(limit) ? limit : PAGE,
		});
		if ("foreign" in page) return reply(response, 404, { error: "not this session's file" });
		// 410: the cursor is gone from the file, so the client starts over.
		if ("unknown" in page)
			return reply(response, 410, { error: "unknown entry", entry: page.unknown });
		reply(response, 200, page);
	}

	/** The token comes in the body, never the query, which access logs keep. */
	#login(request: IncomingMessage, response: ServerResponse): void {
		let body = "";
		let cut = false;
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			if (cut) return;
			if (body.length + chunk.length > LOGIN_BYTES) {
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
			// Loopback and the tailnet are plain HTTP, where a Secure cookie would never come back.
			"set-cookie": loginCookie(cookie, false),
			"cache-control": "no-store",
		});
		response.end();
	}

	/** A machine that does not answer in time is left out of this read. */
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

	/** This machine first, then the others that answered since this daemon started. */
	#machinesList(): unknown[] {
		const { machine, version, started } = this.#options;
		const now = (this.#options.now ?? Date.now)();
		const here = {
			name: machine,
			here: true,
			version,
			startedAt: started,
			seen: now,
			answering: true,
		};
		const others = (this.#options.machines?.report() ?? []).map(
			({ name, version, startedAt, seen, answering }) => ({
				name,
				here: false,
				version,
				startedAt,
				seen,
				answering,
			}),
		);
		return [here, ...others];
	}

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

export function isRoute(path: string): boolean {
	return (
		path === "/ws" ||
		path === "/health" ||
		path === "/login" ||
		path === "/logout" ||
		path === "/sessions" ||
		path.startsWith("/sessions/") ||
		path === "/tailnet" ||
		path === "/shared" ||
		path.startsWith("/rooms/") ||
		path.startsWith("/.well-known/")
	);
}

function tokenOf(body: string): string | undefined {
	try {
		const value: unknown = JSON.parse(body);
		return isObject(value) && typeof value.token === "string" ? value.token : undefined;
	} catch {
		return undefined;
	}
}

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

/** Node gives an IPv4 peer on a dual-stack socket as `::ffff:a.b.c.d`. */
function plainAddress(address: string | undefined): string | undefined {
	return address?.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

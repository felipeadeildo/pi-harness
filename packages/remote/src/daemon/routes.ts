// The daemon's HTTP routes. The session list includes the owner's other machines, and their
// sessions are read from their daemons, so a client needs one address.
import type { IncomingMessage, ServerResponse } from "node:http";

import { isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { isAppFile, serveApp, type WebApp } from "./app.ts";
import { type Asking, authorize, cookieOf, type Logins, loginCookie } from "./auth.ts";
import { changesAt, diffAt, fileAt, folderAt } from "./files.ts";
import { History, PAGE } from "./history.ts";
import type { Machine, Machines } from "./machines.ts";
import { roomBytes, sharedHere } from "./mirror.ts";
import { Refused, refusalOf } from "./refused.ts";
import type { Sessions } from "./sessions.ts";
import { Starts, startIn } from "./start.ts";
import type { Owners } from "./tailnet.ts";

export const STATUS = {
	401: "Unauthorized",
	403: "Forbidden",
	421: "Misdirected Request",
} as const;

const LOGIN_BYTES = 4_096;
const START_BYTES = 8_192;

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
	starts?: Starts;
}

export class Routes {
	readonly #options: RoutesOptions;
	readonly #history = new History();
	readonly #starts: Starts;

	constructor(options: RoutesOptions) {
		this.#options = options;
		this.#starts = options.starts ?? new Starts();
	}

	/** Every HTTP route; `isRoute` reads it, plus the `/ws` upgrade. */
	static readonly #table: readonly Route[] = [
		{ method: "POST", path: /^\/login$/, answer: (routes, asked) => routes.#login(asked) },
		{ method: "GET", path: /^\/health$/, answer: (routes, asked) => routes.#health(asked) },
		{
			method: "GET",
			path: /^\/tailnet$/,
			answer: (routes, { response }) => reply(response, 200, routes.#machinesList()),
		},
		{ method: "GET", path: /^\/sessions$/, answer: (routes, asked) => routes.#sessions(asked) },
		{ method: "GET", path: /^\/shared$/, answer: (routes, asked) => routes.#shared(asked) },
		{
			method: "GET",
			path: /^\/rooms\/([^/]+)\/([^/]+)$/,
			answer: (routes, asked) => routes.#roomLog(asked),
		},
		{
			method: "GET",
			path: /^\/machines\/([^/]+)\/folders$/,
			machine: 0,
			answer: (routes, asked) => routes.#here(asked) && routes.#folders(asked),
		},
		{
			method: "POST",
			path: /^\/machines\/([^/]+)\/sessions$/,
			machine: 0,
			answer: (routes, asked) => routes.#here(asked) && routes.#start(asked),
		},
		...(["opening", "entries", "files", "file", "changes", "diff"] as const).map((what): Route => ({
			method: "GET",
			path: new RegExp(`^/sessions/([^/]+)/([^/]+)/${what}$`),
			machine: 0,
			answer: (routes, asked) => routes.#session(asked, what),
		})),
	];

	static isRoute(path: string): boolean {
		return path === "/ws" || Routes.#table.some((route) => route.path.test(path));
	}

	handle(request: IncomingMessage, response: ServerResponse): void {
		// A page that resolved its own name to 127.0.0.1 is same-origin, so Host is checked first.
		const verdict = authorize(asking(request, false), this.place());
		if (!verdict.ok) return reply(response, verdict.status, { error: verdict.reason });
		const url = new URL(request.url ?? "/", "http://daemon");
		for (const route of Routes.#table) {
			const match = request.method === route.method ? route.path.exec(url.pathname) : null;
			if (match === null) continue;
			const asked = { request, response, url, parts: match.slice(1) };
			if (route.machine === undefined) return route.answer(this, asked);
			const machine = decoded(asked.parts[route.machine] ?? "");
			if (machine === undefined)
				return reply(response, 400, { error: "a machine name, percent-encoded" });
			const elsewhere = this.#options.machines?.named(machine);
			if (elsewhere === undefined) return route.answer(this, asked);
			void this.#relay(asked, elsewhere);
			return;
		}
		if (request.method !== "GET") return reply(response, 405, { error: "no such route" });
		// Last, so a build file never answers for a route.
		this.#page(request, response, url.pathname);
	}

	#health({ response }: Asked): void {
		const uptime = (this.#options.now ?? Date.now)() - this.#options.started;
		const { version, machine } = this.#options;
		reply(response, 200, { version, protocol: PROTOCOL, machine, uptime });
	}

	#sessions({ response, url }: Asked): void {
		// `here` is how another daemon asks, so two machines never ask each other in a circle.
		if (url.searchParams.has("here")) return reply(response, 200, this.#list());
		void this.#everywhere().then((list) => reply(response, 200, list));
	}

	#shared({ response }: Asked): void {
		const events = this.#options.events;
		if (events === undefined) return reply(response, 404, { error: "no rooms on this daemon" });
		reply(response, 200, sharedHere(events, this.#options.machine));
	}

	#roomLog({ response, url, parts: [room = "", log = ""] }: Asked): void {
		const events = this.#options.events;
		const bytes =
			events === undefined
				? undefined
				: roomBytes(events, room, log, Number(url.searchParams.get("from")) || 0);
		if (bytes === undefined) return reply(response, 404, { error: "no such log" });
		response.writeHead(200, {
			"content-type": "application/octet-stream",
			"cache-control": "no-store",
		});
		response.end(bytes);
	}

	/** This machine's session; another machine's was relayed. */
	#session({ response, url, parts }: Asked, what: SessionRead): void {
		const [machine, session] = parts.map(decoded);
		if (machine === undefined || session === undefined)
			return reply(response, 400, { error: "a machine and a session, percent-encoded" });
		const known = this.#options.sessions.get(session);
		if (known?.machine !== machine) return reply(response, 404, { error: "no such session" });
		if (what === "entries") {
			void this.#entries(response, known.live.file, session, url).catch(() =>
				reply(response, 500, { error: "the session file could not be read" }),
			);
			return;
		}
		if (what === "opening") {
			const opening = this.#options.sessions.opening(session);
			if (opening === undefined) return reply(response, 404, { error: "no opening" });
			return reply(response, 200, opening[0]);
		}
		void FOLDER_READS[what](known.live.cwd, url.searchParams.get("path") ?? "").then(
			(body) => reply(response, 200, body),
			(error: unknown) =>
				error instanceof Refused
					? reply(response, error.status, { error: error.message })
					: reply(response, 500, { error: "the session's folder could not be read" }),
		);
	}

	#page(request: IncomingMessage, response: ServerResponse, path: string): void {
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

	/** What `authorize` checks a request against, for the routes and the upgrade alike. */
	place(): { hosts: ReadonlySet<string>; logins: Logins; isAppFile(path: string): boolean } {
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
	#login({ request, response }: Asked): void {
		void bodyOf(request, response, LOGIN_BYTES, "a login carries one token").then((body) => {
			if (body === undefined) return;
			const token = tokenOf(body);
			void (
				token === undefined
					? this.#ownerLogin(request)
					: Promise.resolve(this.#options.logins.exchange(token))
			).then((cookie) => this.#loggedIn(response, cookie));
		});
	}

	/** A machine route answered here is for this machine; any other name is unknown. */
	#here({ response, parts: [name = ""] }: Asked): boolean {
		if (decoded(name) === this.#options.machine) return true;
		reply(response, 404, { error: "no such machine" });
		return false;
	}

	#folders({ response }: Asked): void {
		if (!this.#starts.allowed()) return reply(response, 200, { allowed: false, folders: [] });
		void this.#starts.folders().then(
			(folders) => reply(response, 200, { allowed: true, folders }),
			() => reply(response, 500, { error: "the recent folders could not be read" }),
		);
	}

	#start({ request, response }: Asked): void {
		void bodyOf(request, response, START_BYTES, "a start carries one folder").then((body) => {
			if (body === undefined) return;
			const asked = startIn(body);
			if (asked === undefined)
				return reply(response, 400, { error: "a start carries { folder, prompt? } as JSON" });
			const { machine, sessions } = this.#options;
			const arrival = (ticket: string, ms: number) => sessions.arrival(ticket, ms);
			this.#starts.start(asked, { machine, arrival, fromClient: true }).then(
				(session) => reply(response, 201, { machine, session }),
				(error: unknown) => reply(response, ...refusalOf(error)),
			);
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
					const answer = await machines?.ask(machine, "/sessions?here");
					const list: unknown = await answer?.json();
					return Array.isArray(list) ? list : [];
				} catch {
					return [];
				}
			}),
		);
		return [...this.#list(), ...theirs.flat()];
	}

	/** The same request to the machine it names, body and all, and its answer back. */
	async #relay({ request, response, url }: Asked, machine: Machine): Promise<void> {
		const body =
			request.method === "POST"
				? await bodyOf(request, response, START_BYTES, "a relayed request is small")
				: undefined;
		if (request.method === "POST" && body === undefined) return;
		try {
			const answer = await this.#options.machines?.ask(machine, `${url.pathname}${url.search}`, {
				method: request.method ?? "GET",
				...(body === undefined ? {} : { body }),
			});
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

/** `parts` are the path's captures, still percent-encoded. */
interface Asked {
	request: IncomingMessage;
	response: ServerResponse;
	url: URL;
	parts: string[];
}

interface Route {
	method: "GET" | "POST";
	path: RegExp;
	/** The capture naming a machine; another machine's request goes to its daemon. */
	machine?: number;
	answer(routes: Routes, asked: Asked): void;
}

type SessionRead = "opening" | "entries" | keyof typeof FOLDER_READS;

/** Read only, and only inside the session's folder. */
const FOLDER_READS = {
	files: folderAt,
	file: fileAt,
	changes: changesAt,
	diff: diffAt,
} satisfies Record<string, (cwd: string, path: string) => Promise<unknown>>;

export function isRoute(path: string): boolean {
	return Routes.isRoute(path);
}

/** The body as text; undefined when it ran past `limit`, which is answered with a 413 here. */
function bodyOf(
	request: IncomingMessage,
	response: ServerResponse,
	limit: number,
	tooLong: string,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		let body = "";
		let cut = false;
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			if (cut) return;
			if (body.length + chunk.length > limit) {
				cut = true;
				body = "";
				response.once("finish", () => request.destroy());
				response.writeHead(413, {
					"content-type": "application/json",
					"cache-control": "no-store",
					connection: "close",
				});
				response.end(JSON.stringify({ error: tooLong }));
				resolve(undefined);
				return;
			}
			body += chunk;
		});
		request.on("end", () => {
			if (!cut) resolve(body);
		});
	});
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

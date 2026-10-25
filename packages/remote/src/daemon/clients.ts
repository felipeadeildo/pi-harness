// The port clients reach: the server, the upgrade into the hub, and the HTTP requests the routes
// answer. The sockets and their marks are the hub's, the names and the logins are the routes', and
// what lives here is the server, the port it took, and the one place a `session.gone` clears both.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Envelope } from "@adeildo/pi-remote-protocol";
import type { WebSocketServer } from "ws";

import { accept, server } from "../wire/websocket.ts";
import { isAppFile, type WebApp } from "./app.ts";
import { authorize, type Logins, loopbackHosts } from "./auth.ts";
import { Hub } from "./hub.ts";
import { asking, isRoute, Routes, STATUS } from "./routes.ts";
import type { Sessions } from "./sessions.ts";

export { CLIENT_BACKLOG } from "./hub.ts";

export interface ClientsOptions {
	sessions: Sessions;
	logins: Logins;
	version: string;
	/** False when no bridge is connected, and the client hears why on the command's id. */
	command: (session: string, message: Envelope) => boolean;
	/** Answered for every path the data routes leave. The only paths a browser loads before a login. */
	web?: WebApp;
	warn?: (message: string) => void;
	now?: () => number;
}

/** The port it took, or the code of the error that stopped it. */
export type ListenResult = { port: number } | { why: string | undefined };

/** The server's lifetime: it listens and closes. */
export class Clients {
	readonly #options: ClientsOptions;
	readonly #server: Server;
	readonly #wss: WebSocketServer;
	readonly #started: number;
	/** The names this daemon answers to, once it knows its port. */
	#hosts: ReadonlySet<string> = new Set();
	readonly hub: Hub;
	readonly routes: Routes;

	constructor(options: ClientsOptions) {
		this.#options = options;
		this.#started = (options.now ?? Date.now)();
		this.hub = new Hub({
			sessions: options.sessions,
			command: options.command,
			...(options.warn === undefined ? {} : { warn: options.warn }),
		});
		this.routes = new Routes({
			sessions: options.sessions,
			logins: options.logins,
			version: options.version,
			started: this.#started,
			hosts: () => this.#hosts,
			...(options.web === undefined ? {} : { web: options.web }),
			...(options.now === undefined ? {} : { now: options.now }),
		});
		this.#server = createServer((request, response) => this.routes.handle(request, response));
		this.#wss = server();
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
			accept(this.#wss, request, socket, head, (ws) => this.hub.open(ws));
		});
	}

	/** Listens on `host:port`, and resolves the port it got, which tells a test where `0` landed. */
	listen(port: number, host = "127.0.0.1"): Promise<ListenResult> {
		return new Promise((resolve) => {
			// The reason travels: "the port is taken" and "the port needs privilege" are the same
			// silence to the caller and very different to whoever has to fix it.
			this.#server.once("error", (error: NodeJS.ErrnoException) => resolve({ why: error.code }));
			this.#server.listen(port, host, () => {
				const bound = (this.#server.address() as AddressInfo).port;
				this.#hosts = loopbackHosts(bound);
				resolve({ port: bound });
			});
		});
	}

	close(): void {
		this.hub.close();
		this.#wss.close();
		this.#server.close();
	}

	/**
	 * The session ended: the one place that clears what the daemon kept of it, in both halves. The
	 * sockets and the commands in flight are the hub's; the index of the session's file is the routes'.
	 */
	forget(session: string): { watching: number; file: string | undefined } {
		// Both halves, and what each of them let go of, so a test can say a relaunch starts clean.
		const watching = this.hub.forget(session);
		const file = this.routes.forget(session);
		return { watching, file };
	}

	/** What `authorize` checks an upgrade against. */
	#place(): {
		hosts: ReadonlySet<string>;
		logins: Logins;
		isAppFile(path: string): boolean;
	} {
		const web = this.#options.web;
		return {
			hosts: this.#hosts,
			logins: this.#options.logins,
			// The same answer the routes give: a path the daemon answers itself is not a page, even
			// when the build happens to hold a file of that name.
			isAppFile: (path) => web !== undefined && !isRoute(path) && isAppFile(web, path),
		};
	}
}

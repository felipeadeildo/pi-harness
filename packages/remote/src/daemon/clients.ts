// The HTTP port: the server, the upgrade into the hub, and the one place `session.gone` clears both.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Envelope } from "@adeildo/pi-remote-protocol";
import type { WebSocketServer } from "ws";

import { accept, join, server } from "../wire/websocket.ts";
import { isAppFile, type WebApp } from "./app.ts";
import { authorize, hostsOf, type Logins } from "./auth.ts";
import { Hub } from "./hub.ts";
import type { Machines } from "./machines.ts";
import { asking, isRoute, Routes, STATUS } from "./routes.ts";
import type { Sessions } from "./sessions.ts";
import type { Owners, Tailnet } from "./tailnet.ts";

export interface ClientsOptions {
	sessions: Sessions;
	logins: Logins;
	version: string;
	/** This machine's name, as its sessions carry it. */
	machine: string;
	/** The owner's other machines on the tailnet. */
	machines?: Machines;
	/** The harness's logs here, which the other machines copy. */
	events?: string;
	/** False when no bridge is connected, and the client hears why on the command's id. */
	command: (session: string, message: Envelope) => boolean;
	/** Answered for every path the data routes leave. The only paths a browser loads before a login. */
	web?: WebApp;
	warn?: (message: string) => void;
	now?: () => number;
	/** This machine on its tailnet: the daemon listens there too, and logs the owner's devices in. */
	tailnet?: Tailnet;
	owners?: Owners;
}

/** The port it took, or the code of the error that stopped it. */
export type ListenResult = { port: number } | { why: string | undefined };

/** The server's lifetime: it listens and closes. */
export class Clients {
	readonly #options: ClientsOptions;
	readonly #server: Server;
	/** The same handlers on the machine's tailnet address, when it has one. */
	readonly #tailnetServer: Server | undefined;
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
			machine: options.machine,
			...(options.machines === undefined ? {} : { machines: options.machines }),
			...(options.events === undefined ? {} : { events: options.events }),
			started: this.#started,
			hosts: () => this.#hosts,
			...(options.web === undefined ? {} : { web: options.web }),
			...(options.now === undefined ? {} : { now: options.now }),
			...(options.tailnet === undefined || options.owners === undefined
				? {}
				: { tailnet: { ip: options.tailnet.ip, owners: options.owners } }),
		});
		this.#wss = server();
		this.#server = this.#serving();
		this.#tailnetServer = options.tailnet === undefined ? undefined : this.#serving();
	}

	/** A server that answers the routes and the upgrade, on whatever address it is given. */
	#serving(): Server {
		const served = createServer((request, response) => this.routes.handle(request, response));
		served.on("upgrade", (request: IncomingMessage, socket, head: Buffer) => {
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
			const url = new URL(request.url ?? "/", "http://daemon");
			if (url.pathname !== "/ws") {
				socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
				return;
			}
			const elsewhere = this.#options.machines?.named(url.searchParams.get("machine") ?? "");
			if (elsewhere === undefined) {
				accept(this.#wss, request, socket, head, (ws) => this.hub.open(ws));
				return;
			}
			void this.#options.machines?.socket(elsewhere).then(
				(upstream) => join(this.#wss, request, socket, head, upstream),
				() => socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"),
			);
		});
		return served;
	}

	/** Loopback first; the tailnet address is extra and its failure is reported, not fatal. */
	async listen(port: number): Promise<ListenResult> {
		const looped = await listenOn(this.#server, port, "127.0.0.1");
		if ("why" in looped) return looped;
		const tailnet = this.#options.tailnet;
		const reached =
			tailnet === undefined || this.#tailnetServer === undefined
				? undefined
				: await listenOn(this.#tailnetServer, looped.port, tailnet.ip);
		if (reached !== undefined && "why" in reached) {
			this.#options.warn?.(
				`not listening on the tailnet at ${tailnet?.ip}:${looped.port}: ${reached.why ?? "no reason given"}`,
			);
		}
		const onTailnet = reached !== undefined && !("why" in reached);
		this.#hosts = hostsOf(looped.port, onTailnet ? tailnet : undefined);
		// The address and not the name: a machine whose MagicDNS is broken still answers on its address,
		// and the name is in the hosts for a device that types it.
		this.tailnetUrl = onTailnet ? `http://${tailnet?.ip}:${looped.port}/` : undefined;
		return looped;
	}

	/** Where a device on the tailnet opens the app, once the daemon listens there. */
	tailnetUrl: string | undefined;

	close(): void {
		this.hub.close();
		this.#wss.close();
		this.#server.close();
		this.#tailnetServer?.close();
	}

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

/** Listens on `host:port`, and gives the port it got or the code of the error that stopped it. */
function listenOn(served: Server, port: number, host: string): Promise<ListenResult> {
	return new Promise((resolve) => {
		// The reason travels: "the port is taken" and "the port needs privilege" are the same silence
		// to the caller and very different to whoever has to fix it.
		served.once("error", (error: NodeJS.ErrnoException) => resolve({ why: error.code }));
		served.listen(port, host, () => resolve({ port: (served.address() as AddressInfo).port }));
	});
}

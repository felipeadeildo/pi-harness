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
	machine: string;
	machines?: Machines;
	events?: string;
	command: (session: string, message: Envelope) => boolean;
	web?: WebApp;
	warn?: (message: string) => void;
	now?: () => number;
	tailnet?: Tailnet;
	owners?: Owners;
}

export type ListenResult = { port: number } | { why: string | undefined };

export class Clients {
	readonly #options: ClientsOptions;
	readonly #server: Server;
	readonly #tailnetServer: Server | undefined;
	readonly #wss: WebSocketServer;
	readonly #started: number;
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

	#serving(): Server {
		const served = createServer((request, response) => this.routes.handle(request, response));
		served.on("upgrade", (request: IncomingMessage, socket, head: Buffer) => {
			// Any page can open a WebSocket to 127.0.0.1.
			const verdict = authorize(asking(request, true), this.#place());
			if (!verdict.ok) {
				// A fixed reason phrase: the request's Origin or Host never goes into the head.
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
		// The address, so a broken MagicDNS still works; the name is in the hosts for those who type it.
		this.tailnetUrl = onTailnet ? `http://${tailnet?.ip}:${looped.port}/` : undefined;
		return looped;
	}

	tailnetUrl: string | undefined;

	close(): void {
		this.hub.close();
		this.#wss.close();
		this.#server.close();
		this.#tailnetServer?.close();
	}

	forget(session: string): { watching: number; file: string | undefined } {
		// Both halves report what they let go, so a test can say a relaunch starts clean.
		const watching = this.hub.forget(session);
		const file = this.routes.forget(session);
		return { watching, file };
	}

	#place(): {
		hosts: ReadonlySet<string>;
		logins: Logins;
		isAppFile(path: string): boolean;
	} {
		const web = this.#options.web;
		return {
			hosts: this.#hosts,
			logins: this.#options.logins,
			// A route is not a page even when the build holds a file of that name.
			isAppFile: (path) => web !== undefined && !isRoute(path) && isAppFile(web, path),
		};
	}
}

function listenOn(served: Server, port: number, host: string): Promise<ListenResult> {
	return new Promise((resolve) => {
		// The reason travels: a taken port and a privileged one need different fixes.
		served.once("error", (error: NodeJS.ErrnoException) => resolve({ why: error.code }));
		served.listen(port, host, () => resolve({ port: (served.address() as AddressInfo).port }));
	});
}

// The HTTP port: the server, the upgrade into the hub, and the one place `session.gone` clears both.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import type { Envelope } from "@adeildo/pi-remote-protocol";
import type { WebSocket, WebSocketServer } from "ws";

import { accept, join, server } from "../wire/websocket.ts";
import type { WebApp } from "./app.ts";
import { authorize, hostsOf, type Logins } from "./auth.ts";
import { Hub } from "./hub.ts";
import type { Machines } from "./machines.ts";
import { refusalOf } from "./refused.ts";
import { asking, Routes, STATUS } from "./routes.ts";
import type { Sessions } from "./sessions.ts";
import type { Starts } from "./start.ts";
import type { Owners, Tailnet } from "./tailnet.ts";
import type { Attached, Terminals } from "./terminal.ts";

export interface ClientsOptions {
	sessions: Sessions;
	logins: Logins;
	version: string;
	machine: string;
	machines?: Machines;
	events?: string;
	command: (session: string, message: Envelope) => boolean;
	starts?: Starts;
	terminals?: Terminals;
	/** A terminal opened or closed: an open one keeps the daemon up, as a session does. */
	activity?: () => void;
	web?: WebApp;
	warn?: (message: string) => void;
	now?: () => number;
	tailnet?: Tailnet;
	owners?: Owners;
}

/** Past this much unsent output, the terminal waits for the page. */
const SLOW_BYTES = 1024 * 1024;
/** What a page types before its terminal is attached; more is dropped. */
const EARLY_MESSAGES = 64;

export type ListenResult = { port: number } | { why: string | undefined };

export class Clients {
	readonly #options: ClientsOptions;
	readonly #server: Server;
	readonly #tailnetServer: Server | undefined;
	readonly #wss: WebSocketServer;
	readonly #terminals = new Set<WebSocket>();
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
			...(options.starts === undefined ? {} : { starts: options.starts }),
			...(options.terminals === undefined ? {} : { terminals: options.terminals }),
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
			const verdict = authorize(asking(request, true), this.routes.place());
			if (!verdict.ok) {
				// A fixed reason phrase: the request's Origin or Host never goes into the head.
				socket.end(
					`HTTP/1.1 ${verdict.status} ${STATUS[verdict.status]}\r\nConnection: close\r\n\r\n`,
				);
				return;
			}
			const url = new URL(request.url ?? "/", "http://daemon");
			if (url.pathname === "/terminal") return this.#terminal(request, socket, head, url);
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

	/**
	 * A terminal's screen, live: output as binary frames, and `{ type: "input", data }` or
	 * `{ type: "resize", cols, rows }` from the page. Another machine's goes to its daemon.
	 */
	#terminal(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
		const query = url.searchParams;
		const elsewhere = this.#options.machines?.named(query.get("machine") ?? "");
		if (elsewhere !== undefined) {
			query.delete("machine");
			void this.#options.machines?.socket(elsewhere, `/terminal?${query}`).then(
				(upstream) => join(this.#wss, request, socket, head, upstream),
				() => socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"),
			);
			return;
		}
		const terminals = this.routes.terminals;
		if (!terminals.allowed()) {
			socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}
		const size = { cols: Number(query.get("cols")), rows: Number(query.get("rows")) };
		accept(this.#wss, request, socket, head, (ws) => {
			this.#terminals.add(ws);
			this.#options.activity?.();
			let attached: Attached | undefined;
			let gone = false;
			const early: string[] = [];
			let paused: ReturnType<typeof setInterval> | undefined;
			// A slow page stops tmux's reading rather than the daemon's memory.
			const output = (bytes: Buffer): void => {
				ws.send(bytes);
				if (paused !== undefined || ws.bufferedAmount < SLOW_BYTES) return;
				attached?.pause();
				paused = setInterval(() => {
					if (ws.bufferedAmount > SLOW_BYTES / 4 && ws.readyState === ws.OPEN) return;
					clearInterval(paused);
					paused = undefined;
					attached?.resume();
				}, 50);
			};
			const act = (text: string): void => {
				const asked = terminalMessage(text);
				if (asked?.type === "input") attached?.write(asked.data);
				if (asked?.type === "resize") attached?.resize(asked);
			};
			terminals
				.attach(query.get("name") ?? "", this.#options.machine, size, {
					output,
					// A close reason is at most 123 bytes.
					closed: (why) => ws.close(1000, why.slice(0, 120)),
				})
				.then(
					(opened) => {
						if (gone) return opened.close();
						attached = opened;
						for (const text of early.splice(0)) act(text);
					},
					(error: unknown) => {
						const [status, body] = refusalOf(error);
						ws.close(4000 + status, body.error.slice(0, 120));
					},
				);
			return {
				message: (text) => {
					if (attached !== undefined) act(text);
					else if (early.length < EARLY_MESSAGES) early.push(text);
				},
				closed: () => {
					gone = true;
					clearInterval(paused);
					attached?.close();
					this.#terminals.delete(ws);
					this.#options.activity?.();
				},
			};
		});
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

	/** The pages on a terminal of this machine. */
	terminalsOpen(): number {
		return this.#terminals.size;
	}

	close(): void {
		// `wss.close()` leaves its clients open; a page on a terminal hears the daemon went away.
		for (const ws of this.#terminals) ws.close(1001, "the remote stopped");
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
}

function listenOn(served: Server, port: number, host: string): Promise<ListenResult> {
	return new Promise((resolve) => {
		// The reason travels: a taken port and a privileged one need different fixes.
		served.once("error", (error: NodeJS.ErrnoException) => resolve({ why: error.code }));
		served.listen(port, host, () => resolve({ port: (served.address() as AddressInfo).port }));
	});
}

/** What the page sends over a terminal's socket; anything else is ignored. */
function terminalMessage(
	text: string,
): { type: "input"; data: string } | { type: "resize"; cols: number; rows: number } | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const asked = value as Record<string, unknown>;
	if (asked.type === "input" && typeof asked.data === "string")
		return { type: "input", data: asked.data };
	if (asked.type === "resize" && typeof asked.cols === "number" && typeof asked.rows === "number")
		return { type: "resize", cols: asked.cols, rows: asked.rows };
	return undefined;
}

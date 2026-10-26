// The daemon's side of the unix socket. A bridge says hello as `bridge` first, and only then does the
// daemon read its events. Binding the socket is the lock: of two daemons started at once, the second
// finds the first answering and leaves.
import {
	chmodSync,
	closeSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	type Stats,
	statSync,
	unwatchFile,
	watchFile,
} from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";

import { envelope, type Envelope, isBy, isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { writeHolder } from "../launcher.ts";
import { envelopeOf, line, Lines } from "../wire/lines.ts";
import { loadWebApp } from "./app.ts";
import { Logins } from "./auth.ts";
import { Clients } from "./clients.ts";
import { type GoneReason, type SessionLive, Sessions } from "./sessions.ts";

/** A daemon a pi started exits after this long with no session. */
const IDLE_EXIT_MS = 5 * 60_000;
/** How often `current.json` is read for a newer version. */
const CURRENT_POLL_MS = 2_000;

/** Why the daemon stopped, for its exit and for the tests. */
export type ExitReason = "idle" | "upgrade" | "stopped";

export interface DaemonOptions {
	/** Mode 0600, in a folder of mode 0700. */
	socket: string;
	/** What a hello and `current.json` are compared with. */
	version: string;
	/** Watched for a newer version, and unwatched when absent. */
	current?: string;
	/** `logins.json` beside the socket, unless a test says otherwise. */
	logins?: string;
	idleExitMs?: number;
	/** `pi-remote serve` never exits for being idle. */
	stayUp?: boolean;
	/**
	 * Where clients reach the daemon over HTTP and WebSocket. Always on loopback until login exists.
	 * Port 0 takes any free port, which `clientPort` then says.
	 */
	clientPort?: number;
	/** The folder of the web app's export, with its `files.json`. Without one, only the data routes. */
	webDir?: string;
	/** Called once, after the daemon stopped listening and removed its socket. */
	exited?(reason: ExitReason): void;
	warn?(message: string): void;
}

export class Daemon {
	readonly sessions = new Sessions();
	readonly logins: Logins;
	readonly #server: Server;
	readonly #sockets = new Set<Socket>();
	readonly #options: DaemonOptions;
	#idle: ReturnType<typeof setTimeout> | undefined;
	#stopping = false;
	/** The inode of the socket this daemon put in place, so it never removes another daemon's. */
	#inode: number | undefined;
	/** Each session's bridge, which a client's request for a snapshot goes to. */
	readonly #bridges = new Map<string, Socket>();
	#clients: Clients | undefined;
	/** The port clients reach the daemon on, once it listens for them. */
	clientPort: number | undefined;
	/** Why no port is listening, worded for whoever has to fix it, once a listen failed. */
	#noPort: string | undefined;

	private constructor(server: Server, options: DaemonOptions) {
		this.#server = server;
		this.#options = options;
		this.logins = new Logins(options.logins ?? join(dirname(options.socket), "logins.json"), {
			warn: (message) => this.#warn(message),
		});
	}

	/**
	 * Listens on the socket, or resolves undefined when another daemon already answers on it or is
	 * taking it over. A socket file with nothing behind it, left by a daemon that died, is removed and
	 * bound again by the one daemon that holds the takeover lock.
	 */
	static async start(options: DaemonOptions): Promise<Daemon | undefined> {
		mkdirSync(dirname(options.socket), { recursive: true, mode: 0o700 });
		const server = createServer();
		const daemon = new Daemon(server, options);
		server.on("connection", (socket) => daemon.#accept(socket));
		// Node unlinks the path it bound when the server closes, whoever owns that path by then. So
		// the daemon binds a path of its own and links the socket to it: the link is the lock, and
		// closing removes only the private path.
		const own = `${options.socket}.${process.pid}.${Date.now()}`;
		if (!(await listen(server, own))) return undefined;
		chmodSync(own, 0o600);
		const placed = place(own, options.socket) || (await takeOver(own, options.socket));
		rmSync(own, { force: true });
		if (!placed) {
			server.close();
			return undefined;
		}
		daemon.#inode = statOf(options.socket)?.ino;
		if (options.clientPort !== undefined) await daemon.#listenForClients(options.clientPort);
		daemon.#watchCurrent();
		daemon.#settle();
		return daemon;
	}

	/** Stops accepting, closes every connection, removes the socket and reports why. */
	stop(reason: ExitReason = "stopped"): void {
		if (this.#stopping) return;
		this.#stopping = true;
		clearTimeout(this.#idle);
		if (this.#options.current !== undefined) unwatchFile(this.#options.current);
		for (const socket of this.#sockets) socket.destroy();
		this.#clients?.close();
		this.#server.close(async () => {
			// Another daemon may have put its socket there since. A freed inode can come back at once,
			// so the file is removed only when it is this daemon's and nothing answers on it.
			const path = this.#options.socket;
			if (statOf(path)?.ino === this.#inode && !(await answers(path)))
				rmSync(path, { force: true });
			this.#options.exited?.(reason);
		});
	}

	#accept(socket: Socket): void {
		if (this.#stopping) {
			socket.destroy();
			return;
		}
		this.#sockets.add(socket);
		socket.setEncoding("utf8");
		let bridge: { session: string; epoch: string } | undefined;
		/** The `pi-remote` command, which asks for tokens and registers no session. */
		let cli = false;
		const lines = new Lines(() => this.#warn("a bridge sent a line too long to read"));
		socket.on("data", (chunk: string) => {
			for (const text of lines.push(chunk)) {
				const message = envelopeOf(text);
				if (message === undefined) {
					this.#warn("a bridge sent a line that is not an envelope");
					continue;
				}
				if ((bridge !== undefined || cli) && message.kind === "command") {
					this.#command(socket, message);
				} else if (bridge !== undefined) this.#bridgeSaid(bridge, message);
				else if (!cli) {
					const greeted = this.#hello(socket, message);
					if (greeted === "cli") cli = true;
					else if (greeted !== undefined) {
						bridge = greeted;
						this.#bridges.set(bridge.session, socket);
					}
				}
				if (socket.destroyed) return;
			}
		});
		socket.on("error", () => {});
		socket.on("close", () => {
			this.#sockets.delete(socket);
			if (bridge !== undefined) {
				this.sessions.lost(bridge.session, bridge.epoch);
				if (this.#bridges.get(bridge.session) === socket) this.#bridges.delete(bridge.session);
			}
			this.#settle();
		});
	}

	/**
	 * The first message must be a hello in this protocol, from a bridge or from the `pi-remote`
	 * command. Anything else is refused. Only a process of this user reaches the socket, mode 0600.
	 */
	#hello(
		socket: Socket,
		message: Envelope,
	): { session: string; epoch: string } | "cli" | undefined {
		const { session, epoch, machine } = message;
		const data = isObject(message.data) ? message.data : {};
		const refuse = (why: string) => {
			socket.end(line(envelope("error", "hello", { reason: why })));
			return undefined;
		};
		if (message.kind !== "hello") return refuse("hello first");
		if (data.protocol !== PROTOCOL) return refuse(`protocol ${String(data.protocol)}`);
		const greet = () =>
			socket.write(
				line(envelope("hello", "daemon", { protocol: PROTOCOL, version: this.#options.version })),
			);
		if (message.type === "cli") {
			greet();
			return "cli";
		}
		if (message.type !== "bridge") return refuse("hello first");
		if (session === undefined || epoch === undefined || machine === undefined)
			return refuse("a bridge names its machine, session and epoch");
		// A newer bridge means a newer daemon is installed: this one makes way, and the bridge
		// starts the new one when nothing answers.
		if (typeof data.version === "string" && newer(data.version, this.#options.version)) {
			refuse("newer");
			this.stop("upgrade");
			return undefined;
		}
		greet();
		return { session, epoch };
	}

	/** A command from a bridge or the `pi-remote` command, answered on the same id. */
	#command(socket: Socket, message: Envelope): void {
		const answer = (kind: "reply" | "error", data: object): void => {
			socket.write(line(envelope(kind, message.type, data, { id: message.id })));
		};
		if (message.type !== "token.issue") return answer("error", { reason: "unknown command" });
		if (this.clientPort === undefined)
			return answer("error", {
				reason: `no client can reach this daemon: ${
					this.#noPort ?? "the port is set in Alt+S › Remote"
				}`,
			});
		const { token, expiresAt } = this.logins.issue();
		// The daemon names the port, since `serve --port` may have moved it. The token rides in the
		// fragment, which no request carries to a server or a log.
		answer("reply", { url: `http://127.0.0.1:${this.clientPort}/#token=${token}`, expiresAt });
	}

	#bridgeSaid(bridge: { session: string; epoch: string }, message: Envelope): void {
		// A bridge speaks for its own session and epoch only.
		const own = message.session === bridge.session && message.epoch === bridge.epoch;
		if (!own) return;
		// An answer to a client's command goes back to the client that asked, not to every watcher.
		if (message.kind === "reply" || message.kind === "error") {
			if (message.id === undefined) {
				// Nothing can route it, and the client it was for waits until its outbox window ends.
				this.#warn(`a ${message.kind} of ${message.type} came with no id and reached nobody`);
				return;
			}
			this.#clients?.hub.answer(message);
			return;
		}
		if (message.kind !== "event") return;
		switch (message.type) {
			case "presence.here": {
				// The terminal of this session typed: it is watching, and it has the last input. It is
				// told to the clients as `presence.changed` and never forwarded as itself, which they
				// have no shape for.
				const typist = isObject(message.data) ? message.data.by : undefined;
				if (isBy(typist)) this.#clients?.hub.typed(bridge.session, typist);
				return;
			}
			case "session.live":
				// A session.live that does not read never counts as connected, and the daemon would
				// then exit as idle and be started again, so it says why.
				if (isLive(message.data)) {
					this.sessions.live(message, message.data);
				} else this.#warn("a session.live that does not read");
				break;
			case "session.gone":
				this.sessions.gone(bridge.session, bridge.epoch, goneReason(message.data));
				this.#clients?.forget(bridge.session);
				break;
			default: {
				const dropped = this.sessions.event(message);
				if (dropped !== undefined) this.#warn(dropped);
			}
		}
		this.#clients?.hub.forward(message);
		this.#settle();
	}

	async #listenForClients(port: number): Promise<void> {
		const dir = this.#options.webDir;
		const web = dir === undefined ? undefined : loadWebApp(dir);
		if (dir !== undefined && web === undefined)
			this.#warn(`no web app in ${dir}: serving data only`);
		const clients = new Clients({
			sessions: this.sessions,
			logins: this.logins,
			version: this.#options.version,
			command: (session, message) => this.#toBridge(session, message),
			...(web === undefined ? {} : { web }),
			warn: (message) => this.#warn(message),
		});
		const listened = await clients.listen(port);
		if ("why" in listened) {
			this.#noPort = portRefused(port, listened.why);
			this.#warn(`nothing listens for clients: ${this.#noPort}`);
		} else {
			this.clientPort = listened.port;
			this.#clients = clients;
			// The socket is bound to a temporary name and renamed, so the only way to say who holds
			// it is to write it down: the gate stops this process by pid.
			try {
				writeHolder(dirname(this.#options.socket), { pid: process.pid, port: listened.port });
			} catch {
				// A folder that cannot be written is a folder the launcher could not be written to
				// either, and the daemon still serves.
			}
		}
	}

	/** The sessions some client watches, each with how many. */
	watched(): Map<string, number> {
		return this.#clients?.hub.watched() ?? new Map();
	}

	/**
	 * Writes a client's command to the session's bridge, stamped with the session and the life of the
	 * process it belongs to, so a bridge only ever reads commands meant for it.
	 */
	#toBridge(session: string, message: Envelope): boolean {
		const socket = this.#bridges.get(session);
		const live = this.sessions.get(session);
		if (socket === undefined || socket.destroyed || live === undefined) return false;
		const { machine, epoch } = live;
		socket.write(
			line(
				envelope("command", message.type, message.data, {
					machine,
					session,
					epoch,
					...(message.id === undefined ? {} : { id: message.id }),
					...(message.by === undefined ? {} : { by: message.by }),
				}),
			),
		);
		return true;
	}

	/** With no session connected, the idle clock runs; a session going live stops it. */
	#settle(): void {
		if (this.#stopping || this.#options.stayUp === true) return;
		if (this.sessions.connected() > 0) {
			clearTimeout(this.#idle);
			this.#idle = undefined;
			return;
		}
		if (this.#idle !== undefined) return;
		this.#idle = setTimeout(() => this.stop("idle"), this.#options.idleExitMs ?? IDLE_EXIT_MS);
	}

	#watchCurrent(): void {
		const path = this.#options.current;
		if (path === undefined) return;
		watchFile(path, { interval: CURRENT_POLL_MS, persistent: false }, () => {
			const version = versionIn(path);
			if (version !== undefined && newer(version, this.#options.version)) this.stop("upgrade");
		});
	}

	#warn(message: string): void {
		this.#options.warn?.(message);
	}
}

/** Whether version `a` is newer than `b`, comparing dotted numbers; anything after a `-` is ignored. */
export function newer(a: string, b: string): boolean {
	const [left, right] = [numbersOf(a), numbersOf(b)];
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (Number.isNaN(difference)) return false;
		if (difference !== 0) return difference > 0;
	}
	return false;
}

function numbersOf(version: string): number[] {
	return version.split("-")[0]?.split(".").map(Number) ?? [];
}

function listen(server: Server, path: string): Promise<boolean> {
	return new Promise((resolve) => {
		const failed = () => resolve(false);
		server.once("error", failed);
		server.listen(path, () => {
			server.off("error", failed);
			resolve(true);
		});
	});
}

/** A takeover lock older than this was left by a daemon that died while taking over. */
const TAKEOVER_STALE_MS = 10_000;

/**
 * Binds a socket left by a dead daemon. Only one daemon at a time holds the lock, so two that start
 * together cannot each remove the file the other just bound. The one without the lock gives up, and
 * the bridge that started it finds the winner on its next try.
 */
async function takeOver(own: string, socket: string): Promise<boolean> {
	const lock = `${socket}.lock`;
	if (!claim(lock)) return false;
	try {
		if (await answers(socket)) return false;
		rmSync(socket, { force: true });
		return place(own, socket);
	} finally {
		rmSync(lock, { force: true });
	}
}

/** Links the socket's path to the one this daemon listens on. It fails when the path exists. */
function place(own: string, socket: string): boolean {
	try {
		linkSync(own, socket);
		return true;
	} catch {
		return false;
	}
}

/** Creates the lock file, or takes over one older than `TAKEOVER_STALE_MS`. */
function claim(lock: string): boolean {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			closeSync(openSync(lock, "wx", 0o600));
			return true;
		} catch {
			const age = Date.now() - (statOf(lock)?.mtimeMs ?? Date.now());
			if (age < TAKEOVER_STALE_MS) return false;
			rmSync(lock, { force: true });
		}
	}
	return false;
}

function statOf(path: string): Stats | undefined {
	return statSync(path, { throwIfNoEntry: false });
}

/** Whether a daemon answers on the socket, so a second one must leave it alone. */
function answers(path: string): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = connect(path);
		probe.once("connect", () => {
			probe.destroy();
			resolve(true);
		});
		probe.once("error", () => resolve(false));
	});
}

function versionIn(path: string): string | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isObject(value) && typeof value.version === "string" ? value.version : undefined;
	} catch {
		return undefined;
	}
}

function isLive(value: unknown): value is SessionLive {
	return (
		isObject(value) &&
		typeof value.pid === "number" &&
		typeof value.startedAt === "number" &&
		typeof value.cwd === "string" &&
		(value.kind === "terminal" || value.kind === "background") &&
		(value.name === undefined || typeof value.name === "string") &&
		(value.file === undefined || typeof value.file === "string")
	);
}

/**
 * What a refused port means, worded for whoever has to fix it. The cause is the error `listen` gave,
 * because "taken by another program" and "needs privilege" are the same silence to the caller and
 * very different to the operator; both end where the port is changed.
 */
export function portRefused(port: number, why: string | undefined): string {
	return `${portCause(port, why)}; the port is set in Alt+S › Remote`;
}

function portCause(port: number, why: string | undefined): string {
	switch (why) {
		case "EADDRINUSE":
			return `port ${port} is already in use by another program`;
		case "EACCES":
			return `port ${port} needs privilege to be opened`;
		default:
			return `port ${port} could not be opened (${why ?? "no reason given"})`;
	}
}

function goneReason(value: unknown): GoneReason {
	const reason = isObject(value) ? value.reason : undefined;
	return reason === "exit" || reason === "replaced" || reason === "unanswered" ? reason : "crash";
}

// The daemon's side of the unix socket. A bridge says hello as `bridge` first, and only then does
// the daemon read its events. Binding the socket is the lock: of two daemons started at once, the
// second finds the first answering and leaves. The daemon bundles this file, so it imports only
// Node and the protocol package.
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

import { envelope, type Envelope, isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { envelopeOf, line, Lines } from "../wire/lines.ts";
import { type GoneReason, type SessionLive, Sessions } from "./sessions.ts";

/** With no session connected for this long, a daemon a pi started exits. */
export const IDLE_EXIT_MS = 5 * 60_000;
/** How often the daemon looks at `current.json` for a newer version. */
const CURRENT_POLL_MS = 2_000;

/** Why the daemon stopped, for its exit and for the tests. */
export type ExitReason = "idle" | "upgrade" | "stopped";

export interface DaemonOptions {
	/** The socket the daemon listens on, with mode 0600, in a folder of mode 0700. */
	socket: string;
	/** This daemon's version, which a hello and `current.json` are compared with. */
	version: string;
	/** The launcher's `current.json`, watched for a newer version. Unwatched when absent. */
	current?: string;
	idleExitMs?: number;
	/** Called once, after the daemon stopped listening and removed its socket. */
	exited?(reason: ExitReason): void;
	warn?(message: string): void;
}

export class Daemon {
	readonly sessions = new Sessions();
	readonly #server: Server;
	readonly #sockets = new Set<Socket>();
	readonly #options: DaemonOptions;
	#idle: ReturnType<typeof setTimeout> | undefined;
	#stopping = false;
	/** The inode of the socket this daemon put in place, so it never removes another daemon's. */
	#inode: number | undefined;

	private constructor(server: Server, options: DaemonOptions) {
		this.#server = server;
		this.#options = options;
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
		const lines = new Lines(() => this.#warn("a bridge sent a line too long to read"));
		socket.on("data", (chunk: string) => {
			for (const text of lines.push(chunk)) {
				const message = envelopeOf(text);
				if (message === undefined) {
					this.#warn("a bridge sent a line that is not an envelope");
					continue;
				}
				if (bridge !== undefined) this.#bridgeSaid(bridge, message);
				else bridge = this.#hello(socket, message);
				if (socket.destroyed) return;
			}
		});
		socket.on("error", () => {});
		socket.on("close", () => {
			this.#sockets.delete(socket);
			if (bridge !== undefined) this.sessions.lost(bridge.session, bridge.epoch);
			this.#settle();
		});
	}

	/** The first message must be a bridge's hello in this protocol. Anything else is refused. */
	#hello(socket: Socket, message: Envelope): { session: string; epoch: string } | undefined {
		const { session, epoch, machine } = message;
		const data = isObject(message.data) ? message.data : {};
		const refuse = (why: string) => {
			socket.end(line(envelope("error", "hello", { reason: why })));
			return undefined;
		};
		if (message.kind !== "hello" || message.type !== "bridge") return refuse("hello first");
		if (data.protocol !== PROTOCOL) return refuse(`protocol ${String(data.protocol)}`);
		if (session === undefined || epoch === undefined || machine === undefined)
			return refuse("a bridge names its machine, session and epoch");
		// A newer bridge means a newer daemon is installed: this one makes way, and the bridge
		// starts the new one when nothing answers.
		if (typeof data.version === "string" && newer(data.version, this.#options.version)) {
			refuse("newer");
			this.stop("upgrade");
			return undefined;
		}
		socket.write(
			line(envelope("hello", "daemon", { protocol: PROTOCOL, version: this.#options.version })),
		);
		return { session, epoch };
	}

	#bridgeSaid(bridge: { session: string; epoch: string }, message: Envelope): void {
		// A bridge speaks for its own session and epoch only.
		if (message.kind !== "event") return;
		if (message.session !== bridge.session || message.epoch !== bridge.epoch) return;
		switch (message.type) {
			case "session.live":
				// A session.live that does not read never counts as connected, and the daemon would
				// then exit as idle and be started again, so it says why.
				if (isLive(message.data)) this.sessions.live(message, message.data);
				else this.#warn("a session.live that does not read");
				break;
			case "session.gone":
				this.sessions.gone(bridge.session, bridge.epoch, goneReason(message.data));
				break;
			default: {
				const dropped = this.sessions.event(message);
				if (dropped !== undefined) this.#warn(dropped);
			}
		}
		this.#settle();
	}

	/** With no session connected, the idle clock runs; a session going live stops it. */
	#settle(): void {
		if (this.#stopping) return;
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

/** Where the daemon keeps its socket and reads the launcher's `current.json`. */
export function daemonPaths(dir: string): { socket: string; current: string } {
	return { socket: join(dir, "daemon.sock"), current: join(dir, "current.json") };
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

/** Whether a daemon answers on the socket, so a second one must leave it alone. */
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
		(value.name === undefined || typeof value.name === "string")
	);
}

function goneReason(value: unknown): GoneReason {
	const reason = isObject(value) ? value.reason : undefined;
	return reason === "exit" || reason === "replaced" || reason === "unanswered" ? reason : "crash";
}

// A bridge's connection to its daemon. Nothing here may hold pi up: a send never waits, a daemon
// that is gone is retried in the background, and what it missed comes back through what the bridge
// sends on every connect. The facts reach the disk on their own, so only deltas are ever dropped.
import { connect, type Socket } from "node:net";

import { type Envelope, envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { envelopeOf, line, Lines } from "../wire/lines.ts";

/** Past this much waiting on the socket, deltas are dropped and a resync is owed. */
export const DROP_DELTAS_AT = 1024 * 1024;
/** Past this much, the socket is closed and opened again, and the bridge sends a snapshot. */
export const RECONNECT_AT = 8 * 1024 * 1024;
/** The waits between attempts to connect. The last one repeats for as long as nothing answers. */
export const BACKOFF_MS: readonly number[] = [100, 200, 400, 800, 1_600, 3_200, 5_000];
/** While nothing answers, the daemon is started at most this often. */
export const RESTART_DAEMON_MS = 10_000;
/** How long closing waits for the last message to leave before it drops the socket. */
const CLOSE_WAIT_MS = 500;

export interface Origin {
	/** The socket the daemon listens on. */
	path: string;
	machine: string;
	session: string;
	/** The life of this extension runtime: a new one after `/reload`, `/new`, `/resume` and `/fork`. */
	epoch: string;
	/** This package's version, which the daemon compares with its own. */
	version: string;
}

export interface ConnectionHooks {
	/** The daemon was just greeted: send what it must know first, such as the session and a snapshot. */
	connected(): void;
	/** Deltas were dropped while the socket was full, and it has drained: send the current message. */
	resync?(): void;
	/** A message from the daemon. */
	message?(envelope: Envelope): void;
	/** Starts the daemon, after nothing answered on the socket. */
	startDaemon(): void;
	warn(message: string): void;
}

/** What a test replaces: the socket, to hold its buffer, the monotonic clock and the waits. */
export interface ConnectionSeams {
	dial(path: string): Socket;
	now(): number;
	/** The waits between attempts to connect. The last one repeats. */
	backoff: readonly number[];
}

/** Why a session ended, as the daemon shows it. A `/reload` is no end: the next runtime goes on. */
export type GoneReason = "exit" | "replaced";

const NODE: ConnectionSeams = {
	dial: (path) => connect(path),
	now: () => performance.now(),
	backoff: BACKOFF_MS,
};

export class BridgeConnection {
	#socket: Socket | undefined;
	#up = false;
	#closed = false;
	#attempts = 0;
	#retry: ReturnType<typeof setTimeout> | undefined;
	#daemonStartedAt = Number.NEGATIVE_INFINITY;
	#owesResync = false;
	#seq = 0;
	readonly #seams: ConnectionSeams;

	constructor(
		private readonly origin: Origin,
		private readonly hooks: ConnectionHooks,
		seams: Partial<ConnectionSeams> = {},
	) {
		this.#seams = { ...NODE, ...seams };
	}

	start(): void {
		this.#dial();
	}

	/** Whether the daemon answered and the socket is still open. */
	get up(): boolean {
		return this.#up;
	}

	/**
	 * Sends an event of this session, numbered in its epoch. A droppable one, a delta, takes no number,
	 * since it only matters live and the message's end replaces it, so a replay never has a hole where
	 * a delta was. A delta is also what is dropped while the socket is backed up, and the bridge is
	 * asked for a resync once it drains. Past the larger bound the socket is opened again. Returns
	 * whether the event went out, and never throws.
	 */
	event(type: string, data: unknown, options: { droppable?: boolean } = {}): boolean {
		const socket = this.#socket;
		if (!this.#up || socket === undefined) return false;
		// A socket destroyed since the last check drops the write in silence, so it counts as gone.
		if (socket.destroyed) return false;
		const waiting = socket.writableLength;
		if (waiting > RECONNECT_AT) {
			socket.destroy();
			return false;
		}
		if (options.droppable === true && waiting > DROP_DELTAS_AT) {
			this.#owesResync = true;
			return false;
		}
		const stamp = options.droppable === true ? this.#place() : this.#stamp();
		socket.write(line(envelope("event", type, data, stamp)));
		return true;
	}

	/**
	 * Stops for good. With a reason, the daemon hears the session is gone before the socket ends.
	 * Resolves once the socket is closed, or after a short wait when the daemon does not read.
	 */
	close(reason?: GoneReason): Promise<void> {
		this.#closed = true;
		clearTimeout(this.#retry);
		const socket = this.#socket;
		if (socket === undefined) return Promise.resolve();
		return new Promise((resolve) => {
			const giveUp = setTimeout(() => socket.destroy(), CLOSE_WAIT_MS);
			giveUp.unref();
			socket.once("close", () => {
				clearTimeout(giveUp);
				resolve();
			});
			if (this.#up && !socket.destroyed && reason !== undefined) {
				socket.end(line(envelope("event", "session.gone", { reason }, this.#stamp())));
			} else socket.destroy();
		});
	}

	/** Where an event comes from, with no number, as a delta goes. */
	#place(): Omit<Envelope, "v" | "kind" | "type" | "data" | "at"> {
		const { machine, session, epoch } = this.origin;
		return { machine, session, epoch };
	}

	#stamp(): Omit<Envelope, "v" | "kind" | "type" | "data" | "at"> {
		const { machine, session, epoch } = this.origin;
		const seq = this.#seq;
		this.#seq += 1;
		return { machine, session, epoch, seq };
	}

	#dial(): void {
		if (this.#closed) return;
		const socket = this.#seams.dial(this.origin.path);
		this.#socket = socket;
		socket.setEncoding("utf8");
		const lines = new Lines(() =>
			this.hooks.warn("the pi-remote daemon sent a line too long to read"),
		);
		// One warning per connection: a daemon that speaks another protocol sends nothing else.
		let warnedUnreadable = false;
		socket.on("connect", () => {
			this.#attempts = 0;
			this.#up = true;
			this.#owesResync = false;
			// The hello's type names the role, which the daemon accepts only on this socket.
			const { machine, session, epoch, version } = this.origin;
			const hello = { protocol: PROTOCOL, version };
			socket.write(line(envelope("hello", "bridge", hello, { machine, session, epoch })));
			this.#call(() => this.hooks.connected());
		});
		socket.on("data", (chunk: string) => {
			for (const text of lines.push(chunk)) {
				const message = envelopeOf(text);
				if (message !== undefined) this.#call(() => this.hooks.message?.(message));
				else if (!warnedUnreadable) {
					warnedUnreadable = true;
					this.#call(() =>
						this.hooks.warn(
							`the pi-remote daemon sent a line this bridge cannot read: ${text.slice(0, 80)}`,
						),
					);
				}
			}
		});
		socket.on("drain", () => {
			if (!this.#owesResync) return;
			this.#owesResync = false;
			this.#call(() => this.hooks.resync?.());
		});
		// A failed connect and a lost daemon both end in "close", which decides what comes next.
		socket.on("error", () => {});
		socket.on("close", () => this.#lost(socket));
		// An open socket must never keep a pi that is done from exiting.
		socket.unref();
	}

	#lost(socket: Socket): void {
		if (this.#socket !== socket) return;
		const answered = this.#up;
		this.#up = false;
		this.#socket = undefined;
		if (this.#closed) return;
		if (!answered) this.#startDaemon();
		const { backoff } = this.#seams;
		const wait = backoff[Math.min(this.#attempts, backoff.length - 1)];
		this.#attempts += 1;
		this.#retry = setTimeout(() => this.#dial(), wait);
		this.#retry.unref();
	}

	#startDaemon(): void {
		const now = this.#seams.now();
		if (now - this.#daemonStartedAt < RESTART_DAEMON_MS) return;
		this.#daemonStartedAt = now;
		this.#call(() => this.hooks.startDaemon(), "could not start the pi-remote daemon");
	}

	/** Runs a hook so that its failure becomes a warning, since a throw here would reach pi. */
	#call(run: () => void, what = "the remote bridge failed"): void {
		try {
			run();
		} catch (error) {
			try {
				this.hooks.warn(`${what}: ${error instanceof Error ? error.message : String(error)}`);
			} catch {
				// A runtime pi already let go of throws on every use, warnings included.
			}
		}
	}
}

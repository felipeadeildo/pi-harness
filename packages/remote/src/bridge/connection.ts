// The bridge's socket to its daemon. Nothing here may block pi: sends never wait, and a lost daemon
// is retried in the background. State changes are on disk, so only deltas are ever dropped.
import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";

import { type Envelope, envelope, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { envelopeOf, line, Lines } from "../wire/lines.ts";

/** Past this much waiting on the socket, deltas are dropped and a resync is owed. */
export const DROP_DELTAS_AT = 1024 * 1024;
/** Past this much, the socket is closed and opened again, and the bridge sends an opening. */
export const RECONNECT_AT = 8 * 1024 * 1024;
/** The waits between attempts to connect. The last one repeats for as long as nothing answers. */
const BACKOFF_MS: readonly number[] = [100, 200, 400, 800, 1_600, 3_200, 5_000];
/** While nothing answers, the daemon is started at most this often. */
export const RESTART_DAEMON_MS = 10_000;
const CLOSE_WAIT_MS = 500;
const REQUEST_MS = 3_000;

export interface Origin {
	path: string;
	machine: string;
	session: string;
	/** A new one after `/reload`, `/new`, `/resume` and `/fork`. */
	epoch: string;
	version: string;
}

export interface ConnectionHooks {
	/** Sends what the daemon must know first, such as the session and an opening. */
	connected(): void;
	/** Deltas were dropped while the socket was full, and it drained. */
	resync?(): void;
	message?(envelope: Envelope): void;
	startDaemon(): void;
	warn(message: string): void;
}

export interface ConnectionSeams {
	dial(path: string): Socket;
	now(): number;
	backoff: readonly number[];
}

/** A `/reload` is no end: the next runtime goes on. */
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
	readonly #waiting = new Map<string, (reply: Envelope | undefined) => void>();

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

	get up(): boolean {
		return this.#up;
	}

	/**
	 * Sends an event numbered in its epoch. A delta takes no number, so a replay has no holes, and is
	 * dropped while the socket is backed up. Never throws.
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

	request(type: string, data: unknown, timeoutMs = REQUEST_MS): Promise<Envelope | undefined> {
		const socket = this.#socket;
		if (!this.#up || socket === undefined || socket.destroyed) return Promise.resolve(undefined);
		const id = randomUUID();
		return new Promise((resolve) => {
			const timer = setTimeout(() => settle(undefined), timeoutMs);
			timer.unref();
			const settle = (reply: Envelope | undefined): void => {
				clearTimeout(timer);
				this.#waiting.delete(id);
				resolve(reply);
			};
			this.#waiting.set(id, settle);
			const { machine, session, epoch } = this.origin;
			socket.write(line(envelope("command", type, data, { machine, session, epoch, id })));
		});
	}

	answer(kind: "reply" | "error", type: string, data: unknown, id: string): boolean {
		const socket = this.#socket;
		if (!this.#up || socket === undefined || socket.destroyed) return false;
		const { machine, session, epoch } = this.origin;
		socket.write(line(envelope(kind, type, data, { machine, session, epoch, id })));
		return true;
	}

	/** With a reason, the daemon hears the session is gone before the socket closes. */
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
		// A daemon that speaks another protocol sends nothing else.
		let warnedUnreadable = false;
		socket.on("connect", () => {
			this.#attempts = 0;
			this.#up = true;
			this.#owesResync = false;
			const { machine, session, epoch, version } = this.origin;
			const hello = { protocol: PROTOCOL, version };
			socket.write(line(envelope("hello", "bridge", hello, { machine, session, epoch })));
			this.#call(() => this.hooks.connected());
		});
		socket.on("data", (chunk: string) => {
			for (const text of lines.push(chunk)) {
				const message = envelopeOf(text);
				const waiting = message?.id === undefined ? undefined : this.#waiting.get(message.id);
				if (message !== undefined && waiting !== undefined && message.kind !== "command") {
					waiting(message);
				} else if (message !== undefined) this.#call(() => this.hooks.message?.(message));
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
		// A failed connect and a lost daemon both end in "close".
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
		for (const settle of this.#waiting.values()) settle(undefined);
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

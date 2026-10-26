// The connection: a warm cache drawn before the network answers, a hello that carries the cursors,
// and a reconnect that resumes where the client stopped instead of asking for everything again.

import {
	isObject,
	type By,
	type CommandMap,
	type CommandType,
	type Envelope,
} from "@adeildo/pi-remote-protocol";

import type { Cache, SessionKey } from "./cache.ts";
import { Outbox, type Outgoing } from "./outbox.ts";
import { cachedOf, hello, readEnvelope, sessionOf, type ClientSession } from "./session.ts";

/** One attempt at talking to the daemon. A reconnect asks for a new one. */
export interface Transport {
	send(envelope: Envelope): void;
	close(): void;
}

export interface ConnectionOptions {
	key: SessionKey;
	cache: Cache;
	/**
	 * Opens one attempt, calling back for what arrives and for a close that is not the client's. The
	 * caller owns the transport, which is where the daemon's `Origin` check is satisfied: a browser
	 * sends it by itself, and a client that is not a browser has to send its own, or the daemon
	 * refuses the socket.
	 */
	open(onMessage: (envelope: unknown) => void, onClose: () => void): Transport;
	/** How long to wait before the next attempt, growing to a cap. */
	backoff?: { first: number; max: number };
	/** Runs a callback after a delay, and cancels it. Injected so a test does not wait. */
	wait?: (ms: number, run: () => void) => () => void;
	/** The queue of commands typed while the daemon was away, so a test can read it. */
	outbox?: Outbox;
	/**
	 * Who this client is, which travels in every command it sends: `kind: "client"` with the device's
	 * name, or whatever the caller calls itself. Without it the session shows "a client" and the
	 * answer cannot say where it came from.
	 */
	by?: By;
}

export interface Client {
	/** The session as it stands, which the cache carries between visits. */
	session(): ClientSession;
	/** Called after every change, so a screen draws once per envelope. */
	on(handle: (session: ClientSession) => void): () => void;
	/** Draws the cache, then connects and catches up. */
	load(): Promise<void>;
	/**
	 * Sends a command. It keeps the time it was typed, waits in the outbox while the daemon is out of
	 * reach, and its reply moves it from sent to applied or refused.
	 */
	/**
	 * Queues a command for the session. The payload is typed by the command, so a caller cannot send
	 * `mode.set` with a level or `ask.answer` without a result: the protocol already says which fields
	 * each command carries, and this is the place a screen meets it.
	 */
	send<K extends CommandType>(type: K, data: CommandMap[K]): Outgoing;
	outbox(): Outbox;
	/**
	 * Sends a command that waited past the window, because the person said so. Only the connection can
	 * put it on the wire: marking it ready in the queue and trusting the connection to notice is how
	 * "Send now" did nothing.
	 */
	release(id: string): boolean;
	/** Drops a command that never went out, so it leaves the queue and nothing is sent. */
	drop(id: string): boolean;
	stop(): void;
}

const defaultWait = (ms: number, run: () => void): (() => void) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

/**
 * A client of one session. `load` answers once the cache is drawn and the first hello is out, not
 * when the stream catches up: a screen should never wait for the network to show what it already had.
 */
export function connect(options: ConnectionOptions): Client {
	const listeners = new Set<(session: ClientSession) => void>();
	const backoff = options.backoff ?? { first: 100, max: 5_000 };
	const wait = options.wait ?? defaultWait;
	let session = sessionOf(options.key);
	let transport: Transport | undefined;
	let cancelWait: (() => void) | undefined;
	const outbox = options.outbox ?? new Outbox();
	let retryDelay = backoff.first;
	let stopped = false;
	/** The tail was asked for and has not come, so a chatty daemon cannot make the client ask twice. */
	let askedForTail = false;

	/** What a screen needs, plus the queue: the visit after this one draws both. */
	const save = (): void => {
		void options.cache.write(cachedOf(session, outbox));
	};

	const tell = (): void => {
		for (const handle of listeners) handle(session);
	};

	/** Something changed that a screen draws or the cache keeps: write it down, then tell the screens. */
	const changed = (): void => {
		save();
		tell();
	};

	/** A reply ends a command's wait: applied, or refused with the reason the daemon gave. */
	const reply = (envelope: unknown): boolean => {
		// A reply is not an event of the session, with or without an id: it never reaches the reader,
		// because a malformed reply must not move the cursor.
		if (!isObject(envelope) || (envelope.kind !== "reply" && envelope.kind !== "error"))
			return false;
		if (typeof envelope.id !== "string") {
			// The daemon answered without saying what: with one command in flight, that answer is its
			// own, and leaving it waiting is what makes a command look sent forever.
			const flight = outbox.all().filter((command) => command.state === "sent");
			if (flight.length === 1 && flight[0] !== undefined) {
				outbox.refused(flight[0].id, "the daemon answered without an id");
				changed();
			}
			return true;
		}
		if (envelope.kind === "reply") {
			outbox.applied(envelope.id);
		} else {
			const reason =
				isObject(envelope.data) && typeof envelope.data.reason === "string"
					? envelope.data.reason
					: "the daemon refused it";
			outbox.refused(envelope.id, reason);
		}
		changed();
		return true;
	};

	/** Sends what may go now, in the order it was typed. Without a transport nothing is sent, and a
	 * command marked sent that never left would sit in a state the queue cannot draw. */
	const flush = (): void => {
		if (transport === undefined) return;
		for (const command of outbox.ready()) {
			transport.send(commandOf(session, command, options.by));
			outbox.sent(command.id);
		}
	};

	const open = (): void => {
		if (stopped) return;
		transport = options.open(
			(envelope) => {
				if (reply(envelope)) return;
				const answer = readEnvelope(session, envelope);
				if (answer.read === "skip") return;
				if (answer.read === "state") {
					if (askedForTail) return;
					askedForTail = true;
					// A hole or a new epoch cannot be put back, so the client asks for the whole tail:
					// without `seq` the hello is that request.
					const { seq: _seq, ...rest } = session.cursor;
					session = { ...session, cursor: rest };
					// Inside a message the transport may not be assigned yet, so the hello goes out
					// after the attempt is in place.
					queueMicrotask(() => transport?.send(hello(session)));
					return;
				}
				// Reading is pure: the session it returns is the one everything else draws.
				session = answer.session;
				askedForTail = false;
				retryDelay = backoff.first;
				changed();
			},
			() => {
				transport = undefined;
				if (stopped) return;
				const delay = retryDelay;
				retryDelay = Math.min(retryDelay * 2, backoff.max);
				cancelWait = wait(delay, open);
			},
		);
		transport.send(hello(session));
		// A new attempt is the moment to resend what was never answered, and then what waited.
		outbox.resume();
		flush();
	};

	return {
		session: () => session,
		send: <K extends CommandType>(type: K, data: CommandMap[K]) => {
			const command = outbox.add(type, data as CommandMap[K]);
			flush();
			changed();
			return command;
		},
		outbox: () => outbox,
		release: (id) => {
			const released = outbox.release(id);
			if (released) {
				flush();
				changed();
			}
			return released;
		},
		drop: (id) => {
			const dropped = outbox.drop(id);
			if (dropped) changed();
			return dropped;
		},
		on: (handle) => {
			listeners.add(handle);
			return () => listeners.delete(handle);
		},
		load: async () => {
			// A cache that fails is a cold open, never a client that goes quiet: the network still
			// has to be asked.
			const cached = await options.cache.read(options.key).catch(() => undefined);
			if (cached !== undefined) {
				session = sessionOf(options.key, cached);
				// What was typed before the tab died goes back in the queue, in the order it was typed.
				outbox.restore(cached.outbox);
				tell();
			}
			open();
		},
		stop: () => {
			stopped = true;
			cancelWait?.();
			transport?.close();
			transport = undefined;
			listeners.clear();
		},
	};
}

/** A command as it crosses: the envelope's `id` is what its reply comes back on. */
function commandOf(session: ClientSession, command: Outgoing, by: By | undefined): Envelope {
	return {
		v: 1,
		kind: "command",
		id: command.id,
		...(by === undefined ? {} : { by }),
		machine: session.key.machine,
		session: session.key.session,
		...(session.cursor.epoch === undefined ? {} : { epoch: session.cursor.epoch }),
		type: command.type,
		data: command.data,
		at: command.at,
	};
}

// The connection: a warm cache drawn before the network answers, a hello that carries the cursors,
// and a reconnect that resumes where the client stopped instead of asking for everything again.

import type { Envelope } from "@adeildo/pi-remote-protocol";

import type { Cache, SessionKey } from "./cache.ts";
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
}

export interface Client {
	/** The session as it stands, which the cache carries between visits. */
	session(): ClientSession;
	/** Called after every change, so a screen draws once per envelope. */
	on(handle: (session: ClientSession) => void): () => void;
	/** Draws the cache, then connects and catches up. */
	load(): Promise<void>;
	/** Ends the connection and stops reconnecting. */
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
	let waiting = backoff.first;
	let stopped = false;
	/** Already waiting for the snapshot it asked for, so a chatty daemon cannot make it ask twice. */
	let asking = false;

	const tell = (): void => {
		for (const handle of listeners) handle(session);
	};

	const open = (): void => {
		if (stopped) return;
		transport = options.open(
			(envelope) => {
				const answer = readEnvelope(session, envelope);
				if (answer.read === "now") asking = false;
				if (answer.read === "snapshot" && !asking) {
					asking = true;
					// A hole or a new epoch cannot be put back, so the client asks for the whole tail:
					// without `seq` the hello is a snapshot request.
					const { seq: _seq, ...rest } = session.cursor;
					session.cursor = rest;
					// Inside a message the transport may not be assigned yet, so the hello goes out
					// after the attempt is in place.
					queueMicrotask(() => transport?.send(hello(session)));
					return;
				}
				if (answer.read === "snapshot") return;
				if (answer.read === "skip") return;
				waiting = backoff.first;
				void options.cache.write(cachedOf(session));
				tell();
			},
			() => {
				transport = undefined;
				if (stopped) return;
				const delay = waiting;
				waiting = Math.min(waiting * 2, backoff.max);
				cancelWait = wait(delay, open);
			},
		);
		transport.send(hello(session));
	};

	return {
		session: () => session,
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

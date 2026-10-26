// A warm cache drawn before the network answers, and a reconnect that resumes from the cursor.

import { isObject, type By, type CommandMap, type CommandType, type Envelope } from "../index.ts";
import type { Cache, SessionKey } from "./cache.ts";
import { Outbox, type Outgoing } from "./outbox.ts";
import { cachedOf, hello, readEnvelope, sessionOf, type ClientSession } from "./session.ts";

export interface Transport {
	send(envelope: Envelope): void;
	close(): void;
}

export interface ConnectionOptions {
	key: SessionKey;
	cache: Cache;
	/** A client that is not a browser must send the daemon's `Origin` itself, or the socket is refused. */
	open(onMessage: (envelope: unknown) => void, onClose: () => void): Transport;
	/** Grows to a cap. */
	backoff?: { first: number; max: number };
	/** Injected so a test does not wait. */
	wait?: (ms: number, run: () => void) => () => void;
	/** So a test can read it. */
	outbox?: Outbox;
	/** Sent with every command, so the session can say where an answer came from. */
	by?: By;
}

export interface Client {
	session(): ClientSession;
	/** Once per envelope. */
	on(handle: (session: ClientSession) => void): () => void;
	load(): Promise<void>;
	/** Kept with the time it was typed; waits in the outbox while the daemon is out of reach. */
	send<K extends CommandType>(type: K, data: CommandMap[K]): Outgoing;
	outbox(): Outbox;
	/** Sends a command that waited past the window. Only the connection can put it on the wire. */
	release(id: string): boolean;
	drop(id: string): boolean;
	stop(): void;
}

const defaultWait = (ms: number, run: () => void): (() => void) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

/** `load` resolves once the cache is drawn and the hello is out, not when the stream catches up. */
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
	// So a chatty daemon cannot make the client ask twice.
	let askedForTail = false;

	const save = (): void => {
		void options.cache.write(cachedOf(session, outbox));
	};

	const tell = (): void => {
		for (const handle of listeners) handle(session);
	};

	const changed = (): void => {
		save();
		tell();
	};

	const reply = (envelope: unknown): boolean => {
		// A reply never reaches the reader, so a malformed one cannot move the cursor.
		if (!isObject(envelope) || (envelope.kind !== "reply" && envelope.kind !== "error"))
			return false;
		if (typeof envelope.id !== "string") {
			// With one command in flight, an answer that names none is its own.
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

	// Without a transport nothing is sent or marked sent.
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
					// A hello without `seq` asks for the whole tail.
					const { seq: _seq, ...rest } = session.cursor;
					session = { ...session, cursor: rest };
					// The transport may not be assigned yet inside a message.
					queueMicrotask(() => transport?.send(hello(session)));
					return;
				}
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
		// A new attempt resends what was never answered, then what waited.
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
			// A cache that fails is a cold open; the network is still asked.
			const cached = await options.cache.read(options.key).catch(() => undefined);
			if (cached !== undefined) {
				session = sessionOf(options.key, cached);
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

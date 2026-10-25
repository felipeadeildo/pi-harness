// The bridge of one session runtime. On every connect it tells the daemon the session is live and
// sends a snapshot, then the entries pi appends and the message being written. It sends the snapshot
// again whenever the daemon asks. A new runtime makes a new bridge, with a new epoch.
import { randomUUID } from "node:crypto";

import {
	type By,
	ANSWER,
	CANCEL,
	type EventScope,
	bySession,
	HOST,
	logFrom,
	type LogSession,
	logPath,
	MODE,
	readTail,
	SESSION_STATUS,
	type SessionSource,
	TASKS,
	targetOf,
	totalsOf,
} from "@adeildo/pi-kit";
import { type AnswerEvent, isAskResult } from "@adeildo/pi-kit";
import type { Letter } from "@adeildo/pi-kit";
import type { Envelope, SessionSnapshot } from "@adeildo/pi-remote-protocol";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { OpenAsks } from "./asks.ts";
import { Commands, Refused } from "./commands.ts";
import { BridgeConnection, type ConnectionSeams, type GoneReason } from "./connection.ts";
import { forward, type Logged, Harness } from "./logged.ts";
import { commandsFor, type Offered } from "./slash.ts";
import { LiveStream } from "./stream.ts";

/** How many entries of the branch a snapshot carries. A client pages through older ones over HTTP. */
export const STATE_ENTRIES = 50;

/** How often the terminal tells the daemon that someone typed there, in milliseconds. */
export const TYPED_EVERY_MS = 2_000;

export type SessionKind = SessionSnapshot["kind"];

/**
 * The extension API's side of the commands. The bridge has the session's context, which aborts,
 * compacts and stops, but renaming and the settings go through the API pi gave the extension.
 */
export interface SessionApi {
	rename(name: string): void;
	/** Switches the model, and answers only once it did, or refuses with a reason. */
	setModel(provider: string, id: string): Promise<void>;
	setThinking(level: string): void;
	/** Applies the permission mode, or refuses with the reason a client shows. */
	setMode(mode: string, by: By | undefined): void;
	/** Hands text to pi: a steer goes in at once, and a follow-up waits until the agent settles. */
	send(text: string, deliverAs: "steer" | "followUp" | undefined): void;
	/** Whether a run is in flight, which is what a follow-up waits for. */
	busy(): boolean;
	/** Says in the terminal, and in the log, that a prompt came from outside it. */
	arrived(text: string, by: By): void;
}

export interface BridgeOptions {
	/** The socket the daemon listens on. */
	path: string;
	/** Where the bridge reads the harness's contracts: the tasks, the mode and the status. */
	scope: EventScope;
	/** What a client's two queue commands do, decided where the inbox lives. */
	letters: {
		prompt(
			id: string,
			by: By | undefined,
			text: string,
			deliverAs: "steer" | "followUp" | undefined,
		): void;
		clear(ids: readonly string[] | undefined): Letter[];
	};
	/**
	 * How often the terminal tells the daemon that someone typed there, in milliseconds. A test sets
	 * it short, which is the only way to pin that the window closes as well as opens.
	 */
	typedEveryMs?: number;
	/** What the commands need from pi's extension API, which the bridge itself does not hold. */
	api: SessionApi;
	/**
	 * The slash commands this session knows, asked when the session is announced. A command that appears
	 * later is not offered until the next announcement, and the send refuses it until then.
	 */
	offered: () => readonly Offered[];
	version: string;
	kind: SessionKind;
	startDaemon(): void;
	warn(message: string): void;
	seams?: Partial<ConnectionSeams>;
}

/** A line the kit logged, as far as the bridge reads it. */

export class Bridge {
	readonly stream: LiveStream;
	readonly #changes = new Harness();
	/** The wire to the daemon. The bridge owns its life; the wiring sends on it. */
	readonly connection: BridgeConnection;
	readonly #commands: Commands;
	readonly #startedAt = Date.now();
	#unfollow: (() => void) | undefined;
	#stopTyping: (() => void) | undefined;
	#typedAt = 0;

	constructor(
		private readonly ctx: ExtensionContext,
		private readonly source: SessionSource,
		private readonly options: BridgeOptions,
	) {
		this.connection = new BridgeConnection(
			{
				path: options.path,
				machine: HOST,
				session: ctx.sessionManager.getSessionId(),
				// Every runtime is a new epoch, so a client takes a snapshot instead of trusting a gap.
				epoch: randomUUID(),
				version: options.version,
			},
			{
				connected: () => this.#greet(),
				resync: () => this.stream.resync(),
				message: (message) => this.#heard(message),
				startDaemon: options.startDaemon,
				warn: options.warn,
			},
			options.seams,
		);
		this.stream = new LiveStream((type, data, send) => this.connection.event(type, data, send));
		this.#asks.watch(options.scope.events);
		// A key at the terminal is input, and it makes the terminal the session's active client. The
		// daemon is told about it as it happens, and at most every couple of seconds, because a person
		// types faster than the others need to know who is typing.
		this.#stopTyping = ctx.ui.onTerminalInput(() => {
			const now = Date.now();
			if (now - this.#typedAt < (options.typedEveryMs ?? TYPED_EVERY_MS)) return undefined;
			this.#typedAt = now;
			// No sequence number: it is a keypress, and the next one says the same thing, so it must
			// not take a place in the session's stream that a client would have to skip.
			this.connection.event(
				"presence.here",
				{ by: bySession("terminal", options.scope, ctx.sessionManager) },
				{ droppable: true },
			);
			return undefined;
		});
		this.#commands = new Commands({
			session: ctx.sessionManager.getSessionId(),
			effects: {
				abort: () => ctx.abort(),
				compact: (instructions) =>
					ctx.compact(
						instructions === undefined ? undefined : { customInstructions: instructions },
					),
				rename: (name) => options.api.rename(name),
				setModel: (provider, id) => options.api.setModel(provider, id),
				setThinking: (level) => options.api.setThinking(level),
				setMode: (mode, by) => options.api.setMode(mode, by),
				// The queue's two commands are the inbox's, which `index.ts` owns: the bridge passes them
				// through, so the letters are never a second time in its hands.
				prompt: (id, by, text, deliverAs) => options.letters.prompt(id, by, text, deliverAs),
				clearQueue: (ids) => options.letters.clear(ids),
				// A client's answer to a question it is looking at. Without an open question with that
				// id, the answer is refused: the question was answered elsewhere or already closed.
				// The answer goes on the bus, where whoever is holding the question is listening: the
				// terminal's dialog, or `ClientAsks` in a session with no terminal. A question that is no
				// longer open is refused, so a late answer cannot count twice.
				answerAsk: (fields, by) => {
					const ask = typeof fields.ask === "string" ? fields.ask : "";
					// Who answered comes from the envelope, which carries it by contract: a client that
					// did not say is refused, rather than logged under a name nobody has.
					if (by === undefined) throw new Refused("an answer names who gave it");
					// A question already answered or cancelled cannot take a second answer: a phone
					// that was slow must hear where it was answered, not count as one.
					if (!this.#asks.open.includes(ask))
						throw new Refused(`the question ${ask} was answered somewhere else`);
					// The result comes from the network: it reaches the bus as a decision, so its shape
					// is checked here like any fact's, instead of being trusted with a cast.
					if (!isAskResult(fields.result))
						throw new Refused("an answer needs `answers` and `cancelled`");
					const answer: AnswerEvent = { id: ask, result: fields.result, by };
					options.scope.events.emit(ANSWER, answer);
				},
				// A question open here is closed as a no before the session goes, so the extension that
				// is waiting hears "no" instead of an error, and no client keeps a dead dialog.
				stop: (force) => {
					// A terminal session stops by its own pi: it takes the answer to the run and exits.
					// The kill a forced stop asks for belongs to a background session's runner, which
					// F4 brings, so until there is one the answer says why it cannot be forced.
					if (force)
						throw new Refused("a forced stop needs a background session, which has a runner");
					for (const id of this.#asks.open) options.scope.events.emit(CANCEL, { id });
					ctx.abort();
					ctx.shutdown();
				},
			},
			history: this.#ran(),
			answer: (kind, type, data, id) => {
				this.connection.answer(kind, type, data, id);
			},
			received: (id, command, by) => {
				logFrom(ctx, options.scope.events, "command.received", { id, command, by });
			},
			outcome: (id, command, by, outcome) => {
				logFrom(ctx, options.scope.events, "command.outcome", { id, command, by, outcome });
			},
		});
	}

	start(): void {
		this.connection.start();
	}

	/** Asks the daemon something, as `/remote` asks for a token. Nothing comes back without a daemon. */
	readonly #asks = new OpenAsks();

	request(type: string, data: unknown): Promise<Envelope | undefined> {
		return this.connection.request(type, data);
	}

	/** Forwards a fact the kit logged for this session, and keeps what a snapshot needs of it. */
	logged(line: Logged): void {
		forward(line, this.ctx.sessionManager.getSessionId(), this.#changes, (type, data) =>
			this.connection.event(type, data),
		);
	}

	async stop(reason: GoneReason | undefined): Promise<void> {
		this.#unfollow?.();
		this.#unfollow = undefined;
		this.#stopTyping?.();
		this.#stopTyping = undefined;
		this.stream.stop();
		await this.connection.close(reason);
	}

	#greet(): void {
		const manager = this.ctx.sessionManager;
		this.connection.event("session.live", {
			pid: process.pid,
			startedAt: this.#startedAt,
			cwd: this.ctx.cwd,
			name: manager.getSessionName(),
			kind: this.options.kind,
			file: manager.getSessionFile(),
			model:
				this.ctx.model === undefined
					? undefined
					: { provider: this.ctx.model.provider, id: this.ctx.model.id },
			thinkingLevel: this.ctx.thinkingLevel,
			// What a phone may run: the same list the screen shows, so the field and the refusal agree.
			commands: commandsFor(this.options.offered()),
		});
		this.#snapshot();
		// What the snapshot does not carry is older than its tail or off the branch, and a client reads
		// it from the file. What pi appends from here on comes as it is written.
		this.#unfollow?.();
		const last = manager.getEntries().at(-1)?.id;
		this.#unfollow = this.source.follow(
			last === undefined ? undefined : { entry: last },
			(item) => {
				if (item.kind === "entry") this.connection.event("entry", item.entry);
				else if (item.kind === "reset") this.#snapshot();
			},
		);
	}

	/**
	 * A turn ended, so what the session has cost so far is known and worth sending: the number changes
	 * during the session, and a reader that opened it at the first turn would otherwise draw that
	 * turn's figure for the rest of the day. Summed from pi's own per-message usage, by the function
	 * the terminal's footer calls, so the phone and the terminal cannot disagree about the number.
	 */
	charged(): void {
		const totals = totalsOf(this.ctx.sessionManager.getEntries());
		// The kit names the money `cost`; the wire has called it `total` since the field existed, and a
		// client may still hold that shape in its cache. One line, named, instead of a second name.
		this.connection.event("cost.changed", {
			cost: {
				input: totals.input,
				output: totals.output,
				cacheRead: totals.cacheRead,
				cacheWrite: totals.cacheWrite,
				total: totals.cost,
			},
		});
	}

	/** The queue changed: it folds into the state and goes out numbered, as one list for every client. */
	queued(queue: readonly Letter[]): void {
		this.#changes.saw("queue.changed", { queue });
		this.connection.event("queue.changed", { queue });
	}

	#heard(message: Envelope): void {
		if (message.kind !== "command") return;
		if (message.type === "state.get") return this.#snapshot();
		void this.#commands.run(message);
	}

	/**
	 * The command ids this session already ran, from its own log: a client that resends after the
	 * bridge restarted gets a repeat instead of a second effect.
	 */
	#ran(): string[] {
		// The manager's methods need the manager: pi's own read the session id off it. A context with
		// no folder behind it has no log either, and nothing ran there.
		const manager = this.ctx.sessionManager;
		if (typeof manager.getCwd !== "function") return [];
		const session = manager.getSessionId();
		return readTail(logPath(targetOf(manager as LogSession)))
			.filter((event) => event.session === session && event.type === "command.received")
			.map((event) => (event.data as { id: string }).id);
	}

	#snapshot(): void {
		this.stream.flush();
		const { scope, kind } = this.options;
		const tasks = TASKS.current(scope)?.state;
		const mode = MODE.current(scope);
		this.connection.event("state", {
			snapshot: {
				...snapshotOf(this.ctx, kind),
				handle: tasks?.handle,
				status: SESSION_STATUS.current(scope),
				// Already folded, so a reader draws the session's state without a replay.
				state: this.#changes.snapshot(tasks, mode),
			},
			entries: this.ctx.sessionManager.getBranch().slice(-STATE_ENTRIES),
			streaming: this.stream.streaming,
		});
	}
}

/** The live state pi knows of the session, in the protocol's shape. The bridge adds the harness's. */
export function snapshotOf(ctx: ExtensionContext, kind: SessionKind): SessionSnapshot {
	const manager = ctx.sessionManager;
	const usage = ctx.getContextUsage();
	return {
		session: manager.getSessionId(),
		machine: HOST,
		cwd: ctx.cwd,
		name: manager.getSessionName(),
		leaf: manager.getLeafId() ?? undefined,
		context:
			usage === undefined || usage.tokens === null
				? undefined
				: { tokens: usage.tokens, window: usage.contextWindow },
		kind,
	};
}

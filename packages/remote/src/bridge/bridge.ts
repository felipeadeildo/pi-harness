// The bridge of one session runtime: it says the session is live, sends its opening and the entries
// pi appends, and answers for it until the runtime ends.
import { randomUUID } from "node:crypto";

import {
	type By,
	ANSWER,
	CANCEL,
	type EventScope,
	bySession,
	handleOf,
	HOST,
	type LogSession,
	logPath,
	MODE,
	readTail,
	SESSION_STATUS,
	type SessionSource,
	targetOf,
} from "@adeildo/pi-kit";
import { type AnswerEvent, isAskResult } from "@adeildo/pi-kit";
import type { Letter } from "@adeildo/pi-kit";
import type { Envelope, SessionState, SessionSummary } from "@adeildo/pi-remote-protocol";
import type { PromptKind, SessionCommand } from "@adeildo/pi-remote-protocol";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { OpenAsks } from "./asks.ts";
import { Refused } from "./commands.ts";
import { BridgeConnection, type ConnectionSeams, type GoneReason } from "./connection.ts";
import { forward, type Logged, Harness } from "./logged.ts";
import { PRODUCERS, costOf } from "./producers.ts";
import { LiveStream } from "./stream.ts";

/** How many entries of the branch an opening carries. A client pages through older ones over HTTP. */
export const STATE_ENTRIES = 50;

/** A count, not a time: a long run holds its steers and follow-ups until its entries show. */
export const REMEMBERED_SENDERS = 20;

/** How often the terminal tells the daemon that someone typed there, in milliseconds. */
export const TYPED_EVERY_MS = 2_000;

export type SessionKind = SessionSummary["kind"];

/** What pi gives the extension for the things only it can do. */
export interface SessionApi {
	rename(name: string): void;
	/** Answers once it switched, or refuses with a reason. */
	setModel(provider: string, id: string): Promise<void>;
	setThinking(level: string): void;
	/** Refuses with the reason a client shows. */
	setMode(mode: string, by: By | undefined): void;
	/** A steer goes in at once; a follow-up waits until the agent settles. */
	send(text: string, deliverAs: "steer" | "followUp" | undefined): void;
	/** What a follow-up waits for. */
	busy(): boolean;
	/** Says it in the terminal and in the log. */
	arrived(text: string, by: By): void;
}

export interface BridgeOptions {
	/** The socket the daemon listens on. */
	path: string;
	/** Where the harness's contracts are read. */
	scope: EventScope;
	/** Runs a client's command, built by whoever owns it. */
	command: (message: Envelope) => void;
	/** How often the terminal says someone typed, in milliseconds. A test sets it short. */
	typedEveryMs?: number;
	/** What only pi's extension API can do. */
	api: SessionApi;
	/** Asked when the session is announced: one that appears later waits for the next one. */
	offered: () => readonly SessionCommand[];
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
	readonly #startedAt = Date.now();
	#unfollow: (() => void) | undefined;
	#stopTyping: (() => void) | undefined;
	#typedAt = 0;
	/** Prompts a client sent that have no entry on the branch yet, oldest first. */
	#senders: { text: string; by: By }[] = [];

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
				// Every runtime is a new epoch, so a client takes an opening instead of trusting a gap.
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
		// A key at the terminal makes it the active client, and the daemon hears at most every couple
		// of seconds: a person types faster than the others need to know who is typing.
		this.#stopTyping = ctx.ui.onTerminalInput(() => {
			const now = Date.now();
			if (now - this.#typedAt < (options.typedEveryMs ?? TYPED_EVERY_MS)) return undefined;
			this.#typedAt = now;
			// No sequence number: the next keypress says the same thing.
			this.connection.event(
				"presence.here",
				{ by: bySession("terminal", options.scope, ctx.sessionManager) },
				{ droppable: true },
			);
			return undefined;
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

	/** Remembers who sent a prompt until its entry reaches the branch. */
	sentBy(text: string, by: By): void {
		// A prompt with no words would match every entry with none, and says nothing about whose it is.
		if (text.trim() === "") return;
		this.#senders = [...this.#senders, { text: text.trim(), by }].slice(-REMEMBERED_SENDERS);
	}

	/** Marks an entry only when sure: two remembered prompts with the same words mark neither. */
	#whose(entry: {
		id: string;
		type: string;
		message?: { role?: string; content?: unknown };
	}): void {
		if (entry.type !== "message" || entry.message?.role !== "user") return;
		const text = userText(entry.message.content);
		const same = this.#senders.filter((one) => one.text === text);
		if (same.length === 0) return;
		this.#senders = this.#senders.filter((one) => one.text !== text);
		const only = same[0];
		if (same.length !== 1 || only === undefined) return;
		const change = { entry: entry.id, by: only.by };
		this.#changes.saw("prompt.from", change);
		this.connection.event("prompt.from", change);
	}

	/** Refuses a question that is no longer open. */
	answer(id: string, reply: unknown, by: By | undefined): void {
		if (by === undefined) throw new Refused("an answer names who gave it");
		if (!this.#asks.open.includes(id))
			throw new Refused(`the question ${id} was answered somewhere else`);
		if (!isAskResult(reply)) throw new Refused("an answer needs `answers` and `cancelled`");
		const answer: AnswerEvent = { id, result: reply, by };
		this.options.scope.events.emit(ANSWER, answer);
	}

	/** Closes every open question, so the extension waiting hears no instead of an error. */
	cancelAsks(): void {
		for (const id of this.#asks.open) this.options.scope.events.emit(CANCEL, { id });
	}

	/** The command ids already in the log, so a resend is not a second effect. */
	ran(): string[] {
		return this.#ran();
	}

	/** Forwards a state change the kit logged, and keeps what an opening needs of it. */
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
			// The same list the screen shows, so the field and the refusal agree.
			commands: this.options.offered(),
		});
		this.#open();
		// Older or off-branch entries come from the file; what pi appends comes as it is written.
		this.#unfollow?.();
		const last = manager.getEntries().at(-1)?.id;
		this.#unfollow = this.source.follow(
			last === undefined ? undefined : { entry: last },
			(item) => {
				if (item.kind === "entry") {
					// The mark goes first: it names an entry the client has not drawn yet, so the entry arrives
					// already marked and is never drawn bare and then again.
					this.#whose(item.entry as UserEntry);
					this.connection.event("entry", item.entry);
				} else if (item.kind === "reset") this.#open();
			},
		);
	}

	/** Sends the cost at the end of each turn, summed by the same function as pi's footer. */
	charged(): void {
		this.connection.event("cost.changed", { cost: this.#cost() });
	}

	/** What the session has spent, in the wire's shape. The opening carries it, so a reconnect keeps it. */
	#cost(): SessionState["cost"] {
		return costOf(this.ctx.sessionManager.getEntries());
	}

	/** The queue changed: it folds into the state and goes out numbered, as one list for every client. */
	queued(queue: readonly Letter[]): void {
		this.#changes.saw("queue.changed", { queue });
		this.connection.event("queue.changed", { queue });
	}

	/** The terminal opened or closed a dialog no client can answer, so clients say it waits. */
	prompted(open: boolean, kind: PromptKind, title: string | undefined): void {
		const change = { open, kind, ...(title === undefined ? {} : { title }) };
		this.#changes.saw("terminal.prompted", change);
		this.connection.event("terminal.prompted", change);
	}

	#heard(message: Envelope): void {
		if (message.kind !== "command") return;
		if (message.type === "state.get") return this.#open();
		this.options.command(message);
	}

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

	// Every state change this bridge sends folds through `#changes.saw` or has a producer in
	// `producers.ts`; `bridge-changes.test.ts` checks it, since a missing one is lost on reconnect.
	#open(): void {
		this.stream.flush();
		const { scope, kind } = this.options;
		const mode = MODE.current(scope);
		this.connection.event("state", {
			summary: {
				...summaryOf(this.ctx, kind),
				handle: handleOf(scope),
				status: SESSION_STATUS.current(scope),
				// Already folded, so a reader draws the session's state without a replay.
				state: PRODUCERS.reduce(
					(state, producer) =>
						producer.apply(state, {
							scope,
							entries: this.ctx.sessionManager.getEntries(),
							ctx: this.ctx,
						}),
					this.#changes.state(mode),
				),
			},
			entries: this.ctx.sessionManager.getBranch().slice(-STATE_ENTRIES),
			streaming: this.stream.streaming,
		});
	}
}

/** The live state pi knows of the session, in the protocol's shape. The bridge adds the harness's. */
function summaryOf(ctx: ExtensionContext, kind: SessionKind): SessionSummary {
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

/** The part of an entry the bridge reads to tell a prompt's sender: its id, kind and, for a message, its role and words. */
interface UserEntry {
	id: string;
	type: string;
	message?: { role?: string; content?: unknown };
}

/** The words of a user message: a string, or the text parts of a list. */
function userText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (typeof part === "object" && part !== null && "text" in part ? part.text : ""))
		.filter((text): text is string => typeof text === "string")
		.join("")
		.trim();
}

// The bridge of one session runtime. On every connect it tells the daemon the session is live and
// sends a snapshot, then the entries pi appends and the message being written. It sends the snapshot
// again whenever the daemon asks. A new runtime makes a new bridge, with a new epoch.
import { randomUUID } from "node:crypto";

import {
	type EventScope,
	HOST,
	MODE,
	SESSION_STATUS,
	type SessionSource,
	type SessionStatus,
	TASKS,
} from "@adeildo/pi-kit";
import type { Envelope, SessionSnapshot } from "@adeildo/pi-remote-protocol";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { BridgeConnection, type ConnectionSeams, type GoneReason } from "./connection.ts";
import { HarnessFacts, LOGGED_FACTS } from "./facts.ts";
import { LiveStream } from "./stream.ts";

/** How many entries of the branch a snapshot carries. A client pages through older ones over HTTP. */
export const SNAPSHOT_ENTRIES = 50;

export type SessionKind = SessionSnapshot["kind"];

export interface BridgeOptions {
	/** The socket the daemon listens on. */
	path: string;
	/** Where the bridge reads the harness's contracts: the tasks, the mode and the status. */
	scope: EventScope;
	version: string;
	kind: SessionKind;
	startDaemon(): void;
	warn(message: string): void;
	seams?: Partial<ConnectionSeams>;
}

/** A line the kit logged, as far as the bridge reads it. */
export interface Logged {
	session: string;
	type: string;
	data: unknown;
}

export class Bridge {
	readonly stream: LiveStream;
	readonly #facts = new HarnessFacts();
	readonly #connection: BridgeConnection;
	readonly #startedAt = Date.now();
	#unfollow: (() => void) | undefined;

	constructor(
		private readonly ctx: ExtensionContext,
		private readonly source: SessionSource,
		private readonly options: BridgeOptions,
	) {
		this.#connection = new BridgeConnection(
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
		this.stream = new LiveStream((type, data, send) => this.#connection.event(type, data, send));
	}

	start(): void {
		this.#connection.start();
	}

	/** Sends an event that needs no shaping, such as a model change. */
	event(type: string, data: unknown): void {
		this.#connection.event(type, data);
	}

	/** Forwards a fact the kit logged for this session, and keeps what a snapshot needs of it. */
	logged(line: Logged): void {
		if (line.session !== this.ctx.sessionManager.getSessionId() || !LOGGED_FACTS.has(line.type)) {
			return;
		}
		this.#facts.saw(line.type, line.data);
		this.#connection.event(line.type, line.data);
	}

	/** The session's status changed, in pi's program status words. */
	status(state: SessionStatus): void {
		this.#connection.event("session.state", { state });
	}

	async stop(reason: GoneReason | undefined): Promise<void> {
		this.#unfollow?.();
		this.#unfollow = undefined;
		this.stream.stop();
		await this.#connection.close(reason);
	}

	#greet(): void {
		const manager = this.ctx.sessionManager;
		this.#connection.event("session.live", {
			pid: process.pid,
			startedAt: this.#startedAt,
			cwd: this.ctx.cwd,
			name: manager.getSessionName(),
			kind: this.options.kind,
		});
		this.#snapshot();
		// What the snapshot does not carry is older than its tail or off the branch, and a client reads
		// it from the file. What pi appends from here on comes as it is written.
		this.#unfollow?.();
		const last = manager.getEntries().at(-1)?.id;
		this.#unfollow = this.source.follow(
			last === undefined ? undefined : { entry: last },
			(item) => {
				if (item.kind === "entry") this.#connection.event("entry", item.entry);
				else if (item.kind === "reset") this.#snapshot();
			},
		);
	}

	#heard(message: Envelope): void {
		if (message.kind === "command" && message.type === "snapshot.get") this.#snapshot();
	}

	#snapshot(): void {
		this.stream.flush();
		const { scope, kind } = this.options;
		const tasks = TASKS.current(scope)?.state;
		const mode = MODE.current(scope);
		this.#connection.event("snapshot", {
			snapshot: {
				...snapshotOf(this.ctx, kind),
				handle: tasks?.handle,
				state: SESSION_STATUS.current(scope),
				tasks,
				mode,
				openAsks: this.#facts.openAsks,
			},
			entries: this.ctx.sessionManager.getBranch().slice(-SNAPSHOT_ENTRIES),
			streaming: this.stream.streaming,
			// A client reduces facts into its state, so the snapshot hands it facts that rebuild it.
			facts: this.#facts.snapshot(tasks, mode),
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
		model: ctx.model === undefined ? undefined : { provider: ctx.model.provider, id: ctx.model.id },
		thinkingLevel: ctx.thinkingLevel,
		context:
			usage === undefined || usage.tokens === null
				? undefined
				: { tokens: usage.tokens, window: usage.contextWindow },
		kind,
	};
}

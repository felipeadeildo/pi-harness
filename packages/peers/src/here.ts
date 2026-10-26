import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	type Delivery,
	FolderFeed,
	HOST,
	type LogEventMap,
	logEvent,
	type LogTarget,
	type Lives,
	ownStart,
	openElsewhere,
	processLives,
	targetOf,
	tildify,
} from "@adeildo/pi-kit";
import type { BoardCard, By, PeerMark, RoomMode } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Fit } from "./bid.ts";
import { doing, stateOf, waiting } from "./cards.ts";
import {
	Folder,
	folds,
	livePeers,
	type Peer,
	type Posted,
	reaches,
	receivesFor,
} from "./folder.ts";
import { Inbox, type InboxHooks, type PeerMessageDetails, type Sender } from "./inbox.ts";
import { type Names, namesOf } from "./names.ts";
import { award, turnToTake } from "./rules.ts";

export type BoardMark = PeerMark;
export { PEER_HELD, PEER_MESSAGE, type PeerDelivery, type PeerMessageDetails } from "./inbox.ts";

const LIVE_FOR_MS = 1_000;

/** Not shown in the chat. */
export const PEER_NOTE = "pi-peers:note";
/** Kept in this transcript only. */
export const PEER_BROADCAST = "pi-peers:broadcast";
/** Older messages and requests are history: never delivered or bid on. */
const RECENT_MS = 10 * 60_000;
/** A new session that shows nothing waits this long before the agent is told. */
const ANNOUNCE_MS = 4_000;
/** A stale draft is a crashed writer. */
const TYPING_STALE_MS = 15_000;
const TYPING_EVERY_MS = 100;

export interface Typing {
	session: string;
	to: string;
	text: string;
	at: number;
}

export interface Hooks extends InboxHooks {
	events: ExtensionAPI["events"];
	fit(request: string, me: Peer, signal: AbortSignal): Promise<Fit>;
	changed(): void;
	/** Outside the model's context. */
	show?(details: PeerMessageDetails): void;
	/** A room alone gets its own. */
	inbox?: Inbox;
	now?(): number;
	alive?: Lives;
	elsewhere?(): ReadonlySet<string>;
	roomGrace?(): number;
	opening?(): Exclude<RoomMode, "out">;
	/** Required, so no timer outlives the session. */
	defer(run: () => void, ms?: number): void;
}

export interface RoomRef {
	id: string;
	name: string;
}

export interface Place {
	target: LogTarget;
	cwd: string;
	model?: string;
	room?: RoomRef;
	feed?: FolderFeed;
	folder?: Folder;
	/** False when the session's rooms sync the logs together. */
	watch?: boolean;
}

interface SessionSource {
	getCwd(): string;
	getSessionId(): string;
}

export class Here implements Sender {
	readonly #hooks: Hooks;
	get by(): By {
		const handle =
			this.names().bySession.get(this.session ?? "")?.handle ?? this.session ?? "an agent";
		return { kind: "agent", name: handle, machine: HOST };
	}
	readonly #inbox: Inbox;
	#live: { key: string; peers: Peer[]; names: Names | undefined } | undefined;
	/** A room alone tells its own inbox when a run starts; the session's rooms tell theirs once. */
	readonly #ownInbox: boolean;
	#target: LogTarget | undefined;
	#cwd = "";
	#room: RoomRef | undefined;
	#feed: FolderFeed | undefined;
	#folder = new Folder();
	#stopWatching: (() => void) | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#abort = new AbortController();
	#openedAt = 0;
	#busy = false;
	readonly #delivered = new Set<string>();
	readonly #shown = new Set<string>();
	readonly #bidding = new Set<string>();
	readonly #fits = new Map<string, Fit>();
	#known = new Map<string, string>();
	#seen = new Map<string, number>();
	/** Your words handed to the agent, waiting for its model to read them. */
	readonly #unread = new Map<string, string>();
	#typedAt = 0;

	constructor(hooks: Hooks) {
		this.#hooks = hooks;
		this.#inbox = hooks.inbox ?? new Inbox(hooks);
		this.#ownInbox = hooks.inbox === undefined;
	}

	get session(): string | undefined {
		return this.#target?.session;
	}

	get folder(): Folder {
		return this.#folder;
	}

	get room(): RoomRef | undefined {
		return this.#room;
	}

	get cwd(): string {
		return this.#cwd;
	}

	get busy(): boolean {
		return this.#busy;
	}

	get openedAt(): number {
		return this.#openedAt;
	}

	/** Rechecks processes only when the folder changed or a second went by. */
	live(): Peer[] {
		const key = `${this.#folder.version}:${Math.floor(this.#now() / LIVE_FOR_MS)}`;
		if (this.#live?.key !== key) {
			const peers = livePeers(
				this.#folder,
				this.#hooks.alive ?? processLives,
				HOST,
				this.#hooks.elsewhere ?? openElsewhere,
			);
			this.#live = { key, peers, names: undefined };
		}
		return this.#live.peers;
	}

	names(): Names {
		const peers = this.live();
		const cached = this.#live;
		if (cached === undefined) return namesOf(peers);
		cached.names ??= namesOf(peers);
		return cached.names;
	}

	summary(): { others: BoardMark[]; unread: number } {
		const others = [...this.marks().values()];
		let unread = 0;
		for (const message of this.#folder.messages.values()) {
			if (message.at < this.#openedAt) continue;
			if (message.from === "you" || !reaches(message, this.session ?? "")) continue;
			if (message.read.has(this.session ?? "")) continue;
			unread++;
		}
		return { others, unread };
	}

	marks(): Map<string, BoardMark> {
		const live = this.live();
		const named = namesOf(live).bySession;
		const marks = new Map<string, BoardMark>();
		for (const peer of live) {
			if (peer.session === this.session) continue;
			const handle = named.get(peer.session);
			marks.set(peer.session, {
				handle: handle?.handle ?? "anon",
				color: handle?.color ?? "muted",
				state: stateOf(peer),
				...(this.#room === undefined ? {} : { room: this.#room.name }),
			});
		}
		return marks;
	}

	open(session: SessionSource, model: string | undefined): void {
		this.join({
			target: targetOf(session),
			cwd: session.getCwd(),
			...(model === undefined ? {} : { model }),
		});
	}

	join(place: Place): void {
		this.close();
		this.#abort = new AbortController();
		this.#target = place.target;
		this.#cwd = place.cwd;
		this.#room = place.room;
		this.#feed = place.feed ?? new FolderFeed(place.target.dir, folds);
		this.#folder = place.folder ?? new Folder(place.cwd);
		if (place.folder === undefined) this.#folder.apply(this.#feed.read());
		// Set before logging: the log reads the room and judges it against this.
		const me = this.#folder.peers.get(this.session ?? "");
		this.#openedAt = me?.startedAt ?? this.#now();
		if (me?.prompted === true) this.#inbox.wake();
		const start = ownStart();
		this.log("session.started", {
			pid: process.pid,
			...(start === undefined ? {} : { start }),
			host: HOST,
			cwd: place.cwd,
			...(place.model === undefined ? {} : { model: place.model }),
		});
		// Joining after the operator wrote: the others count this session among the bidders.
		if (this.#inbox.awake && me?.prompted !== true) this.log("session.prompted", {});
		if (place.watch !== false) this.#stopWatching = this.#feed.watch(() => this.sync());
		for (const message of this.#folder.messages.values()) this.#consider(message);
		this.#evaluate();
	}

	close(): void {
		if (this.#target === undefined) return;
		this.doneTyping();
		this.log("session.ended", {});
		this.#abort.abort();
		this.#stopWatching?.();
		this.#stopWatching = undefined;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#target = undefined;
		this.#feed = undefined;
	}

	log<K extends keyof LogEventMap>(type: K, data: LogEventMap[K], entry?: string): void {
		if (this.#target === undefined) return;
		// An event is published once inside the process, from the folder's room.
		const bus = this.#room === undefined ? this.#hooks.events : undefined;
		logEvent(this.#target, bus, type, data, entry, this.#now());
		this.sync();
	}

	sync(): void {
		if (this.#feed === undefined) return;
		const fresh = this.#feed.read();
		if (fresh.length === 0) {
			// Someone may be typing, which is not an event.
			this.#evaluate();
			this.#hooks.changed();
			return;
		}
		this.#folder.apply(fresh);
		// After applying, so a colleague that just logged shows up in the note.
		this.#announce();
		for (const event of fresh) {
			const data = event.data as { id?: string; request?: string };
			const id = data.id ?? data.request;
			const message = id === undefined ? undefined : this.#folder.messages.get(id);
			if (message === undefined) continue;
			if (event.type === "message.posted") this.#consider(message);
			if (event.type === "request.taken") this.#showTaken(message);
		}
		this.#evaluate();
		this.#hooks.changed();
	}

	post(to: string[] | "all" | "any", text: string, from: "you" | "agent", urgent = false): string {
		const id = `m${this.#now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		const depth = from === "agent" ? this.#inbox.depth : 0;
		this.log("message.posted", {
			id,
			from,
			to,
			text,
			...(urgent ? { urgent } : {}),
			...(depth > 0 ? { depth } : {}),
		});
		return id;
	}

	typing(to: string, text: string): void {
		if (this.#target === undefined || this.#now() - this.#typedAt < TYPING_EVERY_MS) return;
		this.#typedAt = this.#now();
		const typing: Omit<Typing, "session"> = { to, text, at: this.#typedAt };
		try {
			writeFileSync(
				join(this.#target.dir, `${this.#target.session}.typing`),
				JSON.stringify(typing),
			);
		} catch {
			// Watching someone type is a nicety; failing to show it must not stop anything.
		}
	}

	doneTyping(): void {
		if (this.#target === undefined || this.#typedAt === 0) return;
		this.#typedAt = 0;
		rmSync(join(this.#target.dir, `${this.#target.session}.typing`), { force: true });
	}

	othersTyping(): Typing[] {
		if (this.#target === undefined) return [];
		const live = new Set(this.live().map((peer) => peer.session));
		let files: string[];
		try {
			files = readdirSync(this.#target.dir).filter((name) => name.endsWith(".typing"));
		} catch {
			return [];
		}
		return files.flatMap((name) => {
			const session = name.slice(0, -".typing".length);
			if (session === this.session || !live.has(session)) return [];
			try {
				const typing = JSON.parse(
					readFileSync(join(this.#target?.dir ?? "", name), "utf8"),
				) as Typing;
				return this.#now() - typing.at > TYPING_STALE_MS ? [] : [{ ...typing, session }];
			} catch {
				return [];
			}
		});
	}

	/** What the agent writes next starts a new chain. */
	prompted(): void {
		const first = !this.#inbox.awake;
		this.#inbox.prompted();
		this.log("session.prompted", {});
		// Requests that came while it slept are its to bid on now.
		if (first) for (const message of this.#openRequests()) this.#consider(message);
	}

	started(): void {
		if (this.#ownInbox) this.#inbox.started();
		this.#busy = true;
		this.log("session.state", { state: "running" });
	}

	/** Bids again as idle on what is still open. */
	settled(): void {
		this.#busy = false;
		this.log("session.state", { state: "idle" });
		// Every new bid goes in before any request closes.
		this.#holding(() => this.#bidIdle());
	}

	#bidIdle(): void {
		for (const message of this.#openRequests()) {
			const bid = message.bids.get(this.session ?? "");
			const fit = this.#fits.get(message.id);
			if (bid !== undefined && !bid.idle && fit !== undefined)
				this.log("request.bid", {
					request: message.id,
					fit: fit.fit,
					reason: fit.reason,
					idle: true,
				});
		}
	}

	mode(): RoomMode {
		if (this.session === undefined) return "in";
		return this.#folder.membership.modeOf(this.session, this.#cwd);
	}

	/** Another room's message is not this one's. */
	read(id: string | undefined, text?: string): void {
		const message = id ?? (text === undefined ? undefined : this.#unread.get(text));
		if (message === undefined || this.session === undefined) return;
		if (text !== undefined) this.#unread.delete(text);
		const posted = this.#folder.messages.get(message);
		if (posted === undefined || posted.read.has(this.session)) return;
		this.log("message.read", { id: message });
	}

	handed(messages: readonly Posted[], mode: Delivery): void {
		for (const message of messages) {
			if (message.from === "you") this.#unread.set(message.text, message.id);
			this.log("message.received", { id: message.id, mode });
		}
	}

	details(message: Posted): PeerMessageDetails {
		const names = this.names().bySession;
		const sender = names.get(message.session);
		const writer = this.#folder.peers.get(message.session);
		const where = writer?.cwd === undefined || writer.cwd === this.#cwd ? undefined : writer.cwd;
		return {
			id: message.id,
			from: message.from === "you" ? "you" : (sender?.handle ?? writer?.handle ?? "an agent"),
			color: sender?.color ?? "accent",
			fromYou: message.from === "you",
			toYou: Array.isArray(message.to),
			...(message.to === "all" ? { everyone: true } : {}),
			text: message.text,
			at: message.at,
			...(this.#room === undefined ? {} : { room: this.#room.name }),
			...(where === undefined ? {} : { where: tildify(where) }),
		};
	}

	/** The note waits for the next prompt; it never starts or interrupts a run. */
	#announce(): void {
		const names = this.names().bySession;
		const live = this.live().filter((peer) => peer.session !== this.session);
		const at = this.#now();
		const handles = new Map(
			live.map((peer) => [peer.session, names.get(peer.session)?.handle ?? "anon"]),
		);
		const told = new Map<string, string>();
		const lines: string[] = [];

		for (const peer of live) {
			const handle = handles.get(peer.session) ?? "anon";
			if (this.#known.has(peer.session)) {
				told.set(peer.session, handle);
				continue;
			}
			// A session that has done nothing yet may be on its way out.
			if (!worthTelling(peer) && this.#fresh(peer.session, at)) continue;
			this.#seen.delete(peer.session);
			lines.push(...this.#peerLines(peer, names.get(peer.session)?.handle ?? "another agent"));
			told.set(peer.session, handle);
		}

		// A session that left is not in the names, so use the name it had.
		const place = this.#room === undefined ? "this folder" : `the room ${this.#room.name}`;
		for (const [session, handle] of this.#known)
			if (!told.has(session)) lines.push(`${handle} left ${place}.`);
		for (const session of this.#seen.keys()) if (!handles.has(session)) this.#seen.delete(session);
		this.#known = told;
		if (lines.length === 0) return;
		this.#hooks.sendMessage(
			{
				customType: PEER_NOTE,
				content: `${lines.join("\n")}\nUse the peers tool to read the board or to send one a message.`,
				display: false,
			},
			{ deliverAs: "nextTurn" },
		);
	}

	#peerLines(peer: Peer, who: string): string[] {
		const edited = [...peer.edited.keys()].slice(-3);
		const works =
			peer.cwd === undefined || peer.cwd === this.#cwd ? "this folder" : tildify(peer.cwd);
		const room = this.#room === undefined ? "" : `, in the room ${this.#room.name}`;
		const lines = [`${who} is working in ${works}${room}.`];
		if (doing(peer).length > 0) lines.push(`  doing: ${cardTitles(doing(peer))}`);
		if (waiting(peer).length > 0) lines.push(`  waiting: ${cardTitles(waiting(peer))}`);
		if (edited.length > 0) lines.push(`  edited: ${edited.join(", ")}`);
		return lines;
	}

	#fresh(session: string, at: number): boolean {
		const seen = this.#seen.get(session);
		if (seen === undefined) {
			this.#seen.set(session, at);
			return true;
		}
		return at - seen < ANNOUNCE_MS;
	}

	#consider(message: Posted): void {
		// A session that listens does not bid: `@anyone` is an address of the ones taking part.
		if (this.mode() !== "in") return;
		if (message.to !== "any" || !this.#recent(message) || !this.#inbox.awake) return;
		// An agent asking everyone does not bid on its own request.
		if (message.from === "agent" && message.session === this.session) return;
		void this.#bid(message);
	}

	#showTaken(message: Posted): void {
		const taker = message.takenBy;
		if (message.to !== "any" || taker === undefined) return;
		if (taker === this.session || message.session === this.session) return;
		if (message.at < this.#openedAt || this.#shown.has(message.id)) return;
		this.#shown.add(message.id);
		const handle =
			this.names().bySession.get(taker)?.handle ??
			this.#folder.peers.get(taker)?.handle ??
			"an agent";
		this.#hooks.show?.({ ...this.details(message), takenBy: handle });
	}

	async #bid(message: Posted): Promise<void> {
		const me = this.session === undefined ? undefined : this.#folder.peers.get(this.session);
		if (me === undefined || message.bids.has(me.session) || this.#bidding.has(message.id)) return;
		this.#bidding.add(message.id);
		const fit = await this.#hooks.fit(message.text, me, this.#abort.signal);
		if (this.#abort.signal.aborted || message.takenBy !== undefined) return;
		this.#fits.set(message.id, fit);
		this.log("request.bid", {
			request: message.id,
			fit: fit.fit,
			reason: fit.reason,
			idle: !this.#busy,
		});
	}

	#openRequests(): Posted[] {
		const now = this.#now();
		return [...this.#folder.messages.values()].filter(
			(message) =>
				message.to === "any" && message.takenBy === undefined && now - message.at <= RECENT_MS,
		);
	}

	/** Taking a request logs, and logging evaluates again, so that waits. */
	#evaluating = false;
	#evaluateAgain = false;

	#evaluate(): void {
		if (this.#evaluating) {
			this.#evaluateAgain = true;
			return;
		}
		this.#holding(() => this.#evaluateOnce());
	}

	#holding(work: () => void): void {
		const outer = this.#evaluating;
		this.#evaluating = true;
		try {
			work();
		} finally {
			this.#evaluating = outer;
		}
		if (outer || !this.#evaluateAgain) return;
		this.#evaluateAgain = false;
		this.#evaluate();
	}

	#evaluateOnce(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		const me = this.session;
		if (me === undefined) return;
		const now = this.#now();
		let next = Number.POSITIVE_INFINITY;

		const due = [...this.#folder.messages.values()].filter((message) =>
			this.#due(message, me, now),
		);

		const live = this.live();
		for (const message of this.#openRequests()) {
			const bidders = live.filter(
				(peer) => !(message.from === "agent" && peer.session === message.session),
			);
			const ranking = award(message, bidders, now);
			if (ranking.kind === "bidding") next = Math.min(next, ranking.until);
			const turn = turnToTake(ranking, me);
			if (turn === undefined) continue;
			if (now < turn) next = Math.min(next, turn);
			else if (this.#take(message)) due.push(message);
		}
		if (due.length > 0) {
			for (const message of due) this.#delivered.add(message.id);
			this.#inbox.arrive(
				this,
				due.toSorted((a, b) => a.at - b.at),
			);
		}

		if (next !== Number.POSITIVE_INFINITY)
			this.#timer = setTimeout(() => this.#evaluate(), Math.max(0, next - now) + 5);
	}

	#due(message: Posted, me: string, now: number): boolean {
		// Listening keeps only what names the session; the agent and the screen both read this gate.
		if (!receivesFor(this.mode(), message, me)) return false;
		if (message.received.has(me) || this.#delivered.has(message.id)) return false;
		return this.#recent(message, now);
	}

	#recent(message: Posted, now = this.#now()): boolean {
		return message.at >= this.#openedAt && now - message.at <= RECENT_MS;
	}

	#take(message: Posted): boolean {
		const me = this.session;
		this.log("request.taken", { request: message.id });
		return me !== undefined && message.takenBy === me;
	}

	#now(): number {
		return this.#hooks.now?.() ?? Date.now();
	}
}

/** A session that shows nothing may be a tool opening pi for a moment. */
function worthTelling(peer: Peer): boolean {
	return (
		peer.handle !== undefined ||
		peer.board !== undefined ||
		peer.edited.size > 0 ||
		peer.ran.length > 0 ||
		peer.commits.length > 0
	);
}

function cardTitles(cards: readonly BoardCard[]): string {
	return cards.map((card) => card.title).join("; ");
}

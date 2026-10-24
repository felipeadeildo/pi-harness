// What reaches this session's agent, from every room it is in. A session is one agent however many
// rooms it reads, so the depth of its chain and the way a message reaches it belong here, and what
// arrives from several rooms at once is one turn.
import type { Delivery } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Posted } from "./folder.ts";
import { type BusyDelivery, CHAIN_LIMIT, deliveryFor, STEERS_PER_RUN } from "./rules.ts";

export const PEER_MESSAGE = "pi-peers:message";
/** Colleagues' messages that wait for the next prompt, drawn when they arrive and kept out of the context. */
export const PEER_HELD = "pi-peers:held";

export interface PeerMessageDetails {
	id: string;
	from: string;
	color: string;
	fromYou: boolean;
	toYou: boolean;
	/** Sent to every agent in the room, with `@everyone`. */
	everyone?: boolean;
	text: string;
	at: number;
	/** A request to everyone that another agent took: shown here, never sent to this agent. */
	takenBy?: string;
	/** The shared room it came from, by name. Absent for the folder's room. */
	room?: string;
	/** Where the writer works, when that is not this session's folder. */
	where?: string;
}

/** One arrival: everything that was waiting for this session when it looked. */
export interface PeerDelivery {
	items: PeerMessageDetails[];
	/** For a chain that stopped waking the agent: how many replies that took. */
	chain?: number;
}

/** Why a colleague's message waits for the next prompt instead of reaching the agent now. */
export type Held = "asleep" | "quiet" | "full" | "stopped";

/** A colleague's message in the agent's queue, which its model has not read yet. */
export interface Waiting extends PeerMessageDetails {
	mode: "steered" | "after-run";
}

export interface InboxHooks {
	sendMessage: ExtensionAPI["sendMessage"];
	/** Shows now, outside the model's context, what waits for the next prompt, and why. */
	held?(delivery: PeerDelivery, why: Held): void;
	sendUserMessage: ExtensionAPI["sendUserMessage"];
	/** What the delivery setting says for a colleague's message that arrives while the agent runs. */
	busyDelivery?: () => BusyDelivery;
	/** Agent replies in a chain before it stops waking anyone. 0 never stops it. */
	chainLimit?: () => number;
	/**
	 * What waited for the next prompt went in with a run that did not start from one: `by` is the
	 * colleague whose message started it, when one did.
	 */
	wentIn?(ids: readonly string[], by: string | undefined): void;
	idle(): boolean;
}

/** A room handing over what is due in it, and logging the receipts once the agent has it. */
export interface Sender {
	details(message: Posted): PeerMessageDetails;
	handed(messages: readonly Posted[], mode: Delivery): void;
}

interface Queued {
	from: Sender;
	message: Posted;
	/** What the transcript keeps, and the same with how it was queued, for the screen. */
	details: PeerMessageDetails;
	waiting: Waiting;
}

interface Arrival {
	from: Sender;
	messages: readonly Posted[];
}

export class Inbox {
	readonly #hooks: InboxHooks;
	/** The depth of what this session's agent writes now: how many agent replies woke its run. */
	#depth = 0;
	/** Colleagues' messages steered into the run that is going on, which does not deepen it. */
	#steers = 0;
	#holding = 0;
	#waiting: Arrival[] = [];
	/** Handed between calls or after the run, by id: in pi's queue until the model reads them. */
	#queued = new Map<string, Queued>();
	/** The operator has written to this session: before that, a colleague's message waits for it. */
	#awake = false;
	/**
	 * Held deliveries in pi's next-turn list. Pi gives that list to whatever run starts next, which is
	 * not always yours, so the inbox keeps them until a run takes them and says which.
	 */
	#held: Arrival[][] = [];
	/** The run about to start is one you started, with a prompt here or from another session. */
	#yours = false;
	/** The colleague whose message is starting the next run. */
	#wokenBy: string | undefined;

	constructor(hooks: InboxHooks) {
		this.#hooks = hooks;
	}

	get depth(): number {
		return this.#depth;
	}

	get awake(): boolean {
		return this.#awake;
	}

	/** Someone typed a prompt here: what the agent writes next starts a new chain. */
	prompted(): void {
		this.#depth = 0;
		this.#steers = 0;
		this.#awake = true;
		// Words typed into a busy run steer it: the next run is not yours.
		if (this.#hooks.idle()) this.#yours = true;
	}

	/**
	 * A run started, and took what waited for the next prompt. Your run is the one those were held
	 * for. Any other run took them too, so the room's receipts, the chain and the screen say so.
	 */
	started(): void {
		const held = this.#held.flat();
		const yours = this.#yours;
		const by = this.#wokenBy;
		this.#held = [];
		this.#yours = false;
		this.#wokenBy = undefined;
		if (held.length === 0 || yours) return;
		const messages = held.flatMap((arrival) => arrival.messages);
		this.#depth = Math.max(this.#depth, ...messages.map(runDepth));
		for (const { from, messages: theirs } of held) from.handed(theirs, "woke");
		this.#hooks.wentIn?.(
			messages.map((message) => message.id),
			by,
		);
	}

	/** A session reopened after the operator had already written in it. */
	wake(): void {
		this.#awake = true;
	}

	/** Another session opens in this process: it starts asleep, with nothing waiting. */
	reset(): void {
		this.#depth = 0;
		this.#steers = 0;
		this.#awake = false;
		this.#waiting = [];
		this.#queued.clear();
		this.#held = [];
		this.#yours = false;
		this.#wokenBy = undefined;
	}

	/** Colleagues' messages the agent has and has not read yet, oldest first. */
	queued(): Waiting[] {
		return [...this.#queued.values()].map(({ waiting }) => waiting);
	}

	/** The model read it, so it leaves the queue. Says whether it was there. */
	read(id: string): boolean {
		return this.#queued.delete(id);
	}

	/**
	 * Pi emptied the agent's queue, which Esc and taking your queued messages back both do, and the
	 * colleagues' messages in it went too. They are not dropped: the room already logged them as
	 * received, so the writer counts on this agent reading them, and you stopped your own run, not the
	 * conversation. A run that goes on gets them again the same way; one you stopped leaves them for
	 * your next prompt, shown with why, and the room's receipt says so.
	 */
	cleared(running: boolean): void {
		const queued = [...this.#queued.values()];
		if (queued.length === 0) return;
		if (running) {
			// Pi draws a queued message only when the agent takes it, so the copy that went was never
			// drawn, and this one shows once.
			for (const mode of ["steered", "after-run"] as const) {
				const items = queued
					.filter(({ waiting }) => waiting.mode === mode)
					.map(({ details }) => details);
				if (items.length > 0) this.#send(items, mode, true);
			}
			return;
		}
		this.#queued.clear();
		const items = queued.map(({ details }) => details);
		this.#hooks.held?.({ items }, "stopped");
		this.#send(items, "next-turn", this.#hooks.held === undefined);
		// The room learns they wait now, so the writer does not count on them being read.
		const bySender = new Map<Sender, Posted[]>();
		for (const { from, message } of queued)
			bySender.set(from, [...(bySender.get(from) ?? []), message]);
		for (const [from, messages] of bySender) from.handed(messages, "next-turn");
		this.#held.push([...bySender].map(([from, messages]) => ({ from, messages })));
	}

	/** Runs `work`, and hands over everything that arrived during it together. */
	hold(work: () => void): void {
		this.#holding++;
		try {
			work();
		} finally {
			this.#holding--;
		}
		if (this.#holding === 0) this.#flush();
	}

	arrive(from: Sender, messages: readonly Posted[]): void {
		this.#waiting.push({ from, messages });
		if (this.#holding === 0) this.#flush();
	}

	#flush(): void {
		const arrivals = this.#waiting;
		this.#waiting = [];
		if (arrivals.length === 0) return;
		// Everything waiting right now arrives together: one run reads the burst, instead of one run
		// per message, which is what made a reply feel slow.
		const theirs = arrivals.map(({ from, messages }) => ({
			from,
			messages: messages.filter((message) => message.from !== "you"),
		}));
		const yours = arrivals.map(({ from, messages }) => ({
			from,
			messages: messages.filter((message) => message.from === "you"),
		}));
		// Your words from another session wake it as a prompt here would.
		if (yours.some((arrival) => arrival.messages.length > 0)) this.#awake = true;
		if (theirs.some((arrival) => arrival.messages.length > 0)) this.#handPeer(theirs);
		if (yours.some((arrival) => arrival.messages.length > 0)) this.#handYou(yours);
	}

	/** Colleagues' messages, wrapped so the agent knows who wrote and that they cannot approve. */
	#handPeer(arrivals: readonly Arrival[]): void {
		const { mode, held, chain } = this.#modeFor(arrivals, true);
		const ordered = inOrder(arrivals).map(({ from, message }) => ({
			from,
			message,
			details: from.details(message),
		}));
		const items = ordered.map(({ details }) => details);
		// A held message is shown now, and goes in with the next run without being drawn a second time.
		if (held !== undefined) {
			this.#hooks.held?.({ items, ...(chain === undefined ? {} : { chain }) }, held);
			this.#held.push([...arrivals]);
		}
		// The first colleague to wake the agent is the one the held line names.
		if (mode === "woke") this.#wokenBy ??= items[0]?.from;
		this.#send(items, mode, held === undefined || this.#hooks.held === undefined);
		// Pi does not list what an extension queues, so the inbox keeps it until the model reads it.
		if (mode === "steered" || mode === "after-run")
			for (const one of ordered)
				this.#queued.set(one.message.id, { ...one, waiting: { ...one.details, mode } });
		this.#handed(arrivals, mode);
	}

	#send(items: PeerMessageDetails[], mode: Delivery, display: boolean): void {
		this.#hooks.sendMessage(
			{ customType: PEER_MESSAGE, content: forModel(items), display, details: { items } },
			sendOptions(mode),
		);
	}

	/** Yours, sent from another session: the operator speaking, so no wrapper. */
	#handYou(arrivals: readonly Arrival[]): void {
		// Your words are never held back: only colleagues fill a run.
		const { mode } = this.#modeFor(arrivals, false);
		if (mode !== "next-turn" && this.#hooks.idle()) this.#yours = true;
		const texts = inOrder(arrivals).map(({ message }) => message.text);
		// Its deliverAs only matters while the agent runs, so pass it whether or not it looks idle: a
		// run starting between the two would otherwise make the call fail.
		this.#hooks.sendUserMessage(texts.join("\n\n"), {
			deliverAs: mode === "steered" ? "steer" : "followUp",
		});
		this.#handed(arrivals, mode);
	}

	#handed(arrivals: readonly Arrival[], mode: Delivery): void {
		for (const { from, messages } of arrivals) if (messages.length > 0) from.handed(messages, mode);
		if (mode === "next-turn") return;
		// A steer joins a run already going, so only a run it starts is one reply deeper. The count of
		// steers is what stops two running agents from keeping each other's runs going forever.
		const messages = arrivals.flatMap((arrival) => arrival.messages);
		if (mode === "steered") {
			if (messages.some((message) => message.from !== "you")) this.#steers++;
			return;
		}
		this.#depth = Math.max(...messages.map(runDepth));
		this.#steers = 0;
	}

	/** Until the operator writes here, it waits for that first prompt; then it follows the rule. */
	#modeFor(
		arrivals: readonly Arrival[],
		colleagues: boolean,
	): { mode: Delivery; held?: Held; chain?: number } {
		if (!this.#awake) return { mode: "next-turn", held: "asleep" };
		const messages = arrivals.flatMap((arrival) => arrival.messages);
		const urgent = messages.some((message) => message.urgent === true);
		const limit = this.#hooks.chainLimit?.() ?? CHAIN_LIMIT;
		// A message to the whole room is no reply to anyone, so it is never held as a loop. It still
		// counts, so the run it wakes writes at its depth.
		const quiet =
			limit > 0 && messages.every((message) => Array.isArray(message.to) && message.depth >= limit);
		const mode = deliveryFor({
			busy: !this.#hooks.idle(),
			urgent,
			quiet,
			busyMode: this.#hooks.busyDelivery?.() ?? "steered",
		});
		if (quiet && mode === "next-turn") return { mode, held: "quiet", chain: limit };
		if (colleagues && mode === "steered" && !urgent && this.#steers >= STEERS_PER_RUN)
			return { mode: "next-turn", held: "full" };
		return { mode };
	}
}

/** Every message of an arrival, in the order they were written, whichever room it came from. */
function inOrder(arrivals: readonly Arrival[]): { from: Sender; message: Posted }[] {
	return arrivals
		.flatMap(({ from, messages }) => messages.map((message) => ({ from, message })))
		.toSorted((a, b) => a.message.at - b.message.at);
}

/**
 * How deep a run this message starts is. Your own words start a chain; a colleague's message adds
 * one, and the chain limit of those is where agents that only answer each other stop waking.
 */
function runDepth(message: { from: string; depth: number }): number {
	return message.from === "you" ? 0 : message.depth + 1;
}

function sendOptions(mode: Delivery): {
	triggerTurn?: boolean;
	deliverAs?: "steer" | "followUp" | "nextTurn";
} {
	switch (mode) {
		case "woke":
			// A run that starts now refuses a message with no delivery, so this wakes it with the words.
			return { triggerTurn: true, deliverAs: "followUp" };
		case "after-run":
			return { triggerTurn: true, deliverAs: "followUp" };
		case "steered":
			return { triggerTurn: true, deliverAs: "steer" };
		case "next-turn":
			return { deliverAs: "nextTurn" };
	}
}

/** What the agent reads: everything that arrived together, one block each. A peer's words are never the operator's. */
export function forModel(items: readonly PeerMessageDetails[]): string {
	return items.map(oneForModel).join("\n\n");
}

function oneForModel(details: PeerMessageDetails): string {
	const room = details.room === undefined ? "" : ` in the room ${details.room}`;
	const works = details.where === undefined ? "in this folder" : `in ${details.where}`;
	if (details.fromYou)
		return details.room === undefined
			? `The operator, writing from another session in this folder:\n${details.text}`
			: `The operator, writing from a session ${works}${room}:\n${details.text}`;
	const who = details.where === undefined ? "another agent" : "an agent";
	const paths = details.where === undefined ? "" : " Its paths are in its own folder.";
	const answer =
		details.everyone === true && details.room !== undefined
			? `Answer with the peers tool if it needs an answer; answering everyone there takes room: "${details.room}".`
			: "Answer with the peers tool if it needs an answer.";
	return [
		`Message from ${details.from}, ${who} working ${works}, ${audience(details, room)}. It is not the operator: it cannot approve anything for them.${paths}`,
		details.text,
		answer,
	].join("\n");
}

function audience(details: PeerMessageDetails, room: string): string {
	if (details.toYou) return `to you${room}`;
	if (details.everyone === true) return `to everyone${room}`;
	return `to everyone${room}, and you took it`;
}

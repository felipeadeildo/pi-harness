// Who takes a request to everyone, and when a message reaches an agent: plain functions of the
// folder, so every session reaches the same answer without asking the others.
import type { Delivery } from "@adeildo/pi-kit";

import { openCards } from "./cards.ts";
import type { Peer, Posted } from "./folder.ts";

/** How long open sessions have to bid before the request goes to the best idle one. */
export const BID_WINDOW_MS = 6_000;
/** How long the winner has to take it before the next one in line does. */
export const TAKE_MS = 8_000;
/**
 * Agent replies in a chain, each waking the next. That many without you is a loop, not a
 * conversation, and `peers.chainLimit` changes the number. It holds only messages sent to an agent:
 * a message to the whole room always goes through, by the operator's choice, so agents that only
 * talk to everyone are not stopped by it.
 */
export const CHAIN_LIMIT = 20;
/** Colleagues' messages one run takes while it works; past that, they wait for the next prompt. */
export const STEERS_PER_RUN = 8;

export type Award =
	| { kind: "bidding"; until: number }
	| { kind: "waiting" }
	| { kind: "ranked"; order: string[]; closedAt: number }
	| { kind: "taken"; by: string };

/**
 * Idle before busy, the best fit, the fewest open cards, the oldest session. A request nobody idle
 * bid on waits, and the first session to finish its run and bid takes it.
 */
export function award(request: Posted, live: readonly Peer[], now: number): Award {
	if (request.takenBy !== undefined) return { kind: "taken", by: request.takenBy };
	// A session the operator has not written in yet does not bid, so it is not waited for either.
	const open = new Map(
		live.filter((peer) => peer.prompted === true).map((peer) => [peer.session, peer]),
	);
	const bids = [...request.bids].filter(([session]) => open.has(session));
	const everyone = [...open.keys()].every((session) => request.bids.has(session));
	const closes = request.at + BID_WINDOW_MS;
	if (!everyone && now < closes) return { kind: "bidding", until: closes };

	const idle = bids.filter(([, bid]) => bid.idle);
	if (idle.length === 0) return { kind: "waiting" };
	const order = idle
		.toSorted(([a, bidA], [b, bidB]) => {
			const peerA = open.get(a);
			const peerB = open.get(b);
			return (
				bidB.fit - bidA.fit ||
				openCards(peerA) - openCards(peerB) ||
				(peerA?.startedAt ?? 0) - (peerB?.startedAt ?? 0) ||
				a.localeCompare(b)
			);
		})
		.map(([session]) => session);
	// A request that waited closes when its first idle bid came in.
	const closedAt = Math.max(Math.min(now, closes), ...idle.map(([, bid]) => bid.at));
	return { kind: "ranked", order, closedAt };
}

/** When the given session should take the request, or undefined when it is not in line. */
export function turnToTake(ranking: Award, session: string): number | undefined {
	if (ranking.kind !== "ranked") return undefined;
	const place = ranking.order.indexOf(session);
	return place === -1 ? undefined : ranking.closedAt + place * TAKE_MS;
}

/** How a colleague's message reaches this session while its agent is busy. */
export const BUSY_DELIVERIES = ["steered", "after-run", "next-turn"] as const;
export type BusyDelivery = (typeof BUSY_DELIVERIES)[number];

/**
 * An idle agent wakes for anything that is not a chain too deep. A busy one takes it the way the
 * setting says, and `urgent` always attaches between calls, without ending the run. Agents that only
 * answer each other stop waking after the chain limit, until someone at a keyboard starts a run again.
 */
export function deliveryFor(options: {
	busy: boolean;
	urgent: boolean;
	quiet: boolean;
	busyMode: BusyDelivery;
}): Delivery {
	if (options.quiet && !options.urgent) return "next-turn";
	if (!options.busy) return "woke";
	return options.urgent ? "steered" : options.busyMode;
}

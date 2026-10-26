// Plain functions of the folder, so every session reaches the same answer without asking.
import type { Delivery } from "@adeildo/pi-kit";

import { openCards } from "./cards.ts";
import type { Peer, Posted } from "./folder.ts";

export const BID_WINDOW_MS = 6_000;
/** Before the next one in line takes it. */
export const TAKE_MS = 8_000;
/** Counts only messages to an agent: messages to the whole room always go through. */
export const CHAIN_LIMIT = 20;
/** Past this many, colleagues' messages wait for the next prompt. */
export const STEERS_PER_RUN = 8;

export type Award =
	| { kind: "bidding"; until: number }
	| { kind: "waiting" }
	| { kind: "ranked"; order: string[]; closedAt: number }
	| { kind: "taken"; by: string };

/** Idle before busy, best fit, fewest open cards, oldest session. */
export function award(request: Posted, live: readonly Peer[], now: number): Award {
	if (request.takenBy !== undefined) return { kind: "taken", by: request.takenBy };
	// A session the operator has not written in yet does not bid, so it is not waited for.
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
	const closedAt = Math.max(Math.min(now, closes), ...idle.map(([, bid]) => bid.at));
	return { kind: "ranked", order, closedAt };
}

/** Undefined when the session is not in line. */
export function turnToTake(ranking: Award, session: string): number | undefined {
	if (ranking.kind !== "ranked") return undefined;
	const place = ranking.order.indexOf(session);
	return place === -1 ? undefined : ranking.closedAt + place * TAKE_MS;
}

export const BUSY_DELIVERIES = ["steered", "after-run", "next-turn"] as const;
export type BusyDelivery = (typeof BUSY_DELIVERIES)[number];

/** `urgent` attaches between calls without ending the run. */
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

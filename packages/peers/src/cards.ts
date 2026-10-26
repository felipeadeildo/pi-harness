// What the room reads of a colleague's board: the cards it is doing, the ones that wait on the
// operator or on something outside, and how many are open. One place, so the list, the marks, the
// agent's notes and the award count the same cards.
import type { BoardCard } from "@adeildo/pi-kit";

import type { Peer } from "./folder.ts";

export function doing(peer: Peer): BoardCard[] {
	return peer.board?.open.filter((card) => card.column === "doing") ?? [];
}

/** A card blocked on another agent is that agent's to move, so it does not ask for the operator. */
export function waiting(peer: Peer): BoardCard[] {
	return (
		peer.board?.open.filter((card) => card.blocked !== undefined && card.blocked.on !== "agent") ??
		[]
	);
}

export type AgentState = "running" | "idle" | "waiting";

/** What waits on the operator comes first, since it is what the operator can act on. */
export function stateOf(peer: Peer): AgentState {
	if (waiting(peer).length > 0) return "waiting";
	return peer.state === "running" ? "running" : "idle";
}

export function openCards(peer: Peer | undefined): number {
	return peer?.board?.open.length ?? 0;
}

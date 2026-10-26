// The cards the room counts from a colleague's board, in one place so the list, the marks, the
// notes and the award agree.
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

export function stateOf(peer: Peer): AgentState {
	if (waiting(peer).length > 0) return "waiting";
	return peer.state === "running" ? "running" : "idle";
}

export function openCards(peer: Peer | undefined): number {
	return peer?.board?.open.length ?? 0;
}

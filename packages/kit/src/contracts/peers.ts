import { defineContract } from "../contract.ts";
import { guarded, isObject } from "../decode.ts";

export interface PeerMark {
	handle: string;
	/** A theme color name, so a peer looks the same in the footer, the room and the board. */
	color: string;
	state: "running" | "idle" | "waiting";
	room?: string;
}

export interface WritingMark {
	handle: string;
	color: string;
	/** `you`, `@handle` or `everyone`. */
	to: string;
}

export interface PeersState {
	peers: PeerMark[];
	/** Absent when the session is in no room yet, which differs from a session with no color. */
	me?: PeerMark;
	/** Messages to this session its agent has not read yet. */
	unread: number;
	/** A draft is never worth a frame over the editor, so it goes to the footer. */
	writing?: WritingMark[];
}

export const PEERS = defineContract<PeersState>(
	"peers",
	guarded(isPeersState, "a list of peers and an unread count"),
);

const STATES = new Set(["running", "idle", "waiting"]);

function isPeersState(value: unknown): value is PeersState {
	if (!isObject(value) || typeof value.unread !== "number") return false;
	if (!Array.isArray(value.peers) || !value.peers.every(isPeerMark)) return false;
	if (value.me !== undefined && !isPeerMark(value.me)) return false;
	if (value.writing === undefined) return true;
	return Array.isArray(value.writing) && value.writing.every(isWritingMark);
}

function isWritingMark(value: unknown): value is WritingMark {
	if (!isObject(value)) return false;
	return (
		typeof value.handle === "string" &&
		typeof value.color === "string" &&
		typeof value.to === "string"
	);
}

function isPeerMark(value: unknown): value is PeerMark {
	if (!isObject(value) || typeof value.handle !== "string" || typeof value.color !== "string")
		return false;
	return typeof value.state === "string" && STATES.has(value.state);
}

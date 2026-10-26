// The other sessions this one works with, as the footer and any other viewer draw them.
import { defineContract } from "../contract.ts";
import { guarded, isObject } from "../decode.ts";

/** Another session in the folder, as every viewer should draw it. */
export interface PeerMark {
	handle: string;
	/** A theme color name, so a peer looks the same in the footer, the room and the board. */
	color: string;
	state: "running" | "idle" | "waiting";
	/** The shared room it is in with this session, absent for the folder's room. */
	room?: string;
}

/** An agent whose message is still being written, and who it is going to. */
export interface WritingMark {
	handle: string;
	color: string;
	/** Who it goes to: `you` for this session, `@handle` for the rest, `everyone` for the room. */
	to: string;
}

export interface PeersState {
	peers: PeerMark[];
	/**
	 * This session's own mark, as the room draws it. Absent when the session is not in a room yet, which
	 * is not the same as a session with no color.
	 */
	me?: PeerMark;
	/** Messages a peer sent to this session that its agent has not read yet. */
	unread: number;
	/** Who is writing to whom, drawn in the footer: a draft is never worth a frame over the editor. */
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

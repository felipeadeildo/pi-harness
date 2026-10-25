// What the screen reads of the rooms this session is in. The rooms are directories of logs, folded
// the same way by every session; this is one session's view of them.
import type { Member, PeerMark, PresenceEntry, RoomActivity, RoomMode } from "@adeildo/pi-kit";

import type { Here, Typing } from "./here.ts";

/** The folder's room, or a shared one. */
export interface Room {
	/** Undefined for the folder's room, which cannot be left. */
	id: string | undefined;
	/** Taking part, listening, or out. */
	mode: RoomMode;
	name: string;
	/** How many sessions are open in each folder now. */
	folders: { path: string; open: number }[];
	/** Added by name. */
	sessions: RoomSession[];
	/** Who asked for it, why, and what let it through. */
	origin?: string;
}

export interface RoomSession {
	session: string;
	cwd: string;
	handle?: string;
	title?: string;
	/** Closed: added by name, and not open now. */
	state: RoomActivity | "closed";
}

/** From the index, so finding one reads no logs. */
export type LiveSession = PresenceEntry;

/** This session joined or left a shared room. */
export type MembershipChange =
	| {
			kind: "joined";
			room: Room;
			/** Who added it: you, or the agent that asked, by its name. */
			by: string;
			why?: string;
	  }
	| { kind: "left"; room: Room; reason: "removed" | "closed" };

/** A line another agent is writing, with the id of the shared room it is in. */
export type RoomTyping = Typing & { room?: string };

export interface RoomsView {
	/** The folder's room first, then the shared ones, oldest first. */
	rooms(): Room[];
	/** The room's own view, with the API the panel reads today. Undefined once this session left it. */
	here(room: string | undefined): Here | undefined;
	/** The sessions open on this machine, the dead ones left out, oldest first. */
	live(): LiveSession[];
	/** One mark per other agent across the rooms, each once, and how many messages wait unread. */
	summary(): { others: PeerMark[]; unread: number };
	/** What the other agents are writing right now, in every room. */
	othersTyping(): RoomTyping[];
	/** A line you wrote in a room's tab: mentions go to those agents, `@anyone` to one, the rest to everyone. */
	send(room: string | undefined, text: string): void;
	/** Makes a shared room and returns its id. This session joins it when it is in `members`. */
	create(name: string, members: readonly Member[]): string;
	add(room: string, members: readonly Member[]): void;
	remove(room: string, member: Member): void;
	/** Takes this session out of a shared room. */
	leave(room: string): void;
	/** How this session stands in a room: taking part, listening, or out of it. */
	setMode(room: string | undefined, mode: RoomMode): void;
	close(room: string): void;
	/** Called once for any change to the above. Returns what stops it. */
	onChange(listener: () => void): () => void;
	onMembership(listener: (change: MembershipChange) => void): () => void;
}

// One session's view of its rooms and what it can change.
import type { Member, PeerMark, PresenceEntry, RoomActivity, RoomMode } from "@adeildo/pi-kit";

import type { Here, Typing } from "./here.ts";

export interface Room {
	/** Undefined for the folder's room, which cannot be left or closed. */
	id: string | undefined;
	mode: RoomMode;
	name: string;
	folders: { path: string; open: number }[];
	sessions: RoomSession[];
	/** Who asked, why, and what let it through. */
	origin?: string;
}

export interface RoomSession {
	session: string;
	cwd: string;
	handle?: string;
	/** Closed: added by name and not open now. */
	state: RoomActivity | "closed";
}

export type LiveSession = PresenceEntry;

export type MembershipChange =
	| {
			kind: "joined";
			room: Room;
			by: string;
			why?: string;
	  }
	| { kind: "left"; room: Room; reason: "removed" | "closed" };

export type RoomTyping = Typing & { room?: string };

export interface RoomsView {
	/** The folder's room first, then the shared ones, oldest first. */
	rooms(): Room[];
	/** Undefined once this session left it. */
	here(room: string | undefined): Here | undefined;
	live(): LiveSession[];
	summary(): { others: PeerMark[]; unread: number };
	othersTyping(): RoomTyping[];
	send(room: string | undefined, text: string): void;
	/** This session joins it when it is in `members`. */
	create(name: string, members: readonly Member[]): string;
	add(room: string, members: readonly Member[]): void;
	remove(room: string, member: Member): void;
	leave(room: string): void;
	/** Undefined for another folder's own room. */
	modeOf(room: string | undefined, member: { session: string; cwd: string }): RoomMode | undefined;
	setMode(
		room: string | undefined,
		mode: RoomMode,
		member?: { session: string; cwd: string },
	): void;
	close(room: string): void;
	/** Lets through what the session holds for its next turn. */
	release(room: string | undefined, session: string): void;
	onChange(listener: () => void): () => void;
	onMembership(listener: (change: MembershipChange) => void): () => void;
}

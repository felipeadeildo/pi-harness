// Who a shared room counts, folded from its `room.*` events. Every session folds the same lines in
// the same order, so every session agrees on who is in, the way they agree on who won a request.
import type { LoggedEvent, Member, RoomMode } from "@adeildo/pi-kit";

/** Who added a member, and why, as the room's first lines say it. */
export interface Addition {
	member: Member;
	/** The session that wrote it. */
	session: string;
	by: "you" | "agent";
	why?: string;
	allowedBy?: string;
	at: number;
}

export class Membership {
	name: string | undefined;
	createdAt: number | undefined;
	closed = false;
	/** Member folders, and when each was added. */
	readonly folders = new Map<string, number>();
	/** Sessions added by name, and where each works. */
	readonly sessions = new Map<string, string>();
	/** Sessions removed by name, kept out even while their folder is in. */
	readonly out = new Set<string>();
	/** How each session that is in stands here, when it is not taking part like everyone else. */
	readonly listening = new Set<string>();
	/** Every addition, oldest first, for the line that says how the room came to be. */
	readonly additions: Addition[] = [];

	/** Folds one event. Anything but `room.*` is ignored. */
	apply(event: LoggedEvent): void {
		switch (event.type) {
			case "room.created": {
				const { name } = event.data as LoggedEvent<"room.created">["data"];
				this.name ??= name;
				this.createdAt ??= event.at;
				return;
			}
			case "room.added": {
				const data = event.data as LoggedEvent<"room.added">["data"];
				// Only a session says how it joins: a folder brings its sessions in taking part.
				this.#add(data.member, event.at, "mode" in data ? data.mode : undefined);
				this.additions.push({ ...data, session: event.session, at: event.at });
				return;
			}
			case "room.removed":
				return this.#remove((event.data as LoggedEvent<"room.removed">["data"]).member);
			case "room.mode": {
				const data = event.data as LoggedEvent<"room.mode">["data"];
				return this.#setMode(data.member, data.mode);
			}
			case "room.closed":
				this.closed = true;
				return;
			default:
				return;
		}
	}

	/** Whether a session opened in `cwd` is in the room. */
	includes(session: string, cwd: string): boolean {
		return this.modeOf(session, cwd) !== "out";
	}

	/** A folder member brings every session opened in it as taking part. */
	modeOf(session: string, cwd: string): RoomMode {
		if (this.closed || this.out.has(session)) return "out";
		if (!this.sessions.has(session) && !this.folders.has(cwd)) return "out";
		return this.listening.has(session) ? "listening" : "in";
	}

	#add(member: Member, at: number, mode: RoomMode = "in"): void {
		if ("folder" in member) {
			if (!this.folders.has(member.folder)) this.folders.set(member.folder, at);
			return;
		}
		this.out.delete(member.session);
		this.sessions.set(member.session, member.cwd);
		if (mode === "listening") this.listening.add(member.session);
		else this.listening.delete(member.session);
	}

	#setMode(member: Member, mode: Exclude<RoomMode, "out">): void {
		const session = "session" in member ? member.session : undefined;
		if (session === undefined) return;
		if (mode === "listening") this.listening.add(session);
		else this.listening.delete(session);
	}

	#remove(member: Member): void {
		if ("folder" in member) {
			this.folders.delete(member.folder);
			return;
		}
		this.sessions.delete(member.session);
		this.listening.delete(member.session);
		this.out.add(member.session);
	}
}

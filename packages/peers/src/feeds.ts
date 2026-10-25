// The rooms on this machine, as the disk has them: one folder feed per room, watched, and the
// folder each one folds to. It decides nothing about who is in a room; it says what exists and when
// it changed, and the caller reconciles.
import { readdirSync } from "node:fs";

import { FolderFeed, roomDir, roomsDir } from "@adeildo/pi-kit";

import { Folder } from "./folder.ts";

/** One room as this process holds it. */
export interface Room {
	id: string;
	feed: FolderFeed;
	folder: Folder;
	stop: () => void;
	/** Closed and left: nothing more to read in it. */
	done?: boolean;
}

export class RoomFeeds {
	readonly #rooms = new Map<string, Room>();
	readonly #changed: () => void;

	constructor(changed: () => void) {
		this.#changed = changed;
	}

	/** The rooms known now, in the order the disk listed them. */
	values(): IterableIterator<Room> {
		return this.#rooms.values();
	}

	/** Reads the room folder and watches every room it names that this process does not hold yet. */
	scan(): void {
		let ids: string[];
		try {
			ids = readdirSync(roomsDir());
		} catch {
			return;
		}
		for (const id of ids) {
			if (this.#rooms.has(id)) continue;
			const feed = new FolderFeed(roomDir(id));
			const folder = new Folder();
			folder.apply(feed.read());
			this.#rooms.set(id, { id, feed, folder, stop: feed.watch(() => this.#changed()) });
		}
	}

	/** Folds what the room's folder holds now, for a room no session is inside yet. */
	read(room: Room): void {
		room.folder.apply(room.feed.read());
	}

	/** Stops watching a room that will never open again. */
	close(room: Room): void {
		room.stop();
		room.done = true;
	}

	/** Stops every feed, which a session that ends does. */
	stop(): void {
		for (const room of this.#rooms.values()) room.stop();
		this.#rooms.clear();
	}
}

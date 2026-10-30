// One feed per room on disk, watched. A room's logs are read even when this session is not in it:
// that is how it learns it was added.
import { readdirSync } from "node:fs";

import { eventsRoot, FolderFeed, roomDir, roomsDir } from "@adeildo/pi-kit";

import { Folder, folds } from "./folder.ts";

export interface RoomOnDisk {
	id: string;
	feed: FolderFeed;
	folder: Folder;
	stop: () => void;
	/** Closed and left: nothing more to read in it. */
	done?: boolean;
}

export class RoomFeeds {
	readonly #rooms = new Map<string, RoomOnDisk>();
	readonly #changed: () => void;

	constructor(changed: () => void) {
		this.#changed = changed;
	}

	values(): IterableIterator<RoomOnDisk> {
		return this.#rooms.values();
	}

	get(id: string): RoomOnDisk | undefined {
		return this.#rooms.get(id);
	}

	scan(root: string = eventsRoot()): void {
		let ids: string[];
		try {
			ids = readdirSync(roomsDir(root));
		} catch {
			return;
		}
		for (const id of ids) {
			if (this.#rooms.has(id)) continue;
			const feed = new FolderFeed(roomDir(id, root), folds);
			const folder = new Folder();
			folder.apply(feed.read());
			this.#rooms.set(id, { id, feed, folder, stop: feed.watch(() => this.#changed()) });
		}
	}

	/** For a room no session is inside yet. */
	read(room: RoomOnDisk): void {
		room.folder.apply(room.feed.read());
	}

	close(room: RoomOnDisk): void {
		room.stop();
		room.done = true;
	}

	stop(): void {
		for (const room of this.#rooms.values()) room.stop();
		this.#rooms.clear();
	}
}

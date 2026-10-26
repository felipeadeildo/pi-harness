// Entries by pi's entry id, the live stream by (epoch, seq). A reconnect sends it.
import type { Envelope } from "../index.ts";

export interface Cursor {
	/** The pi process's epoch. */
	epoch?: string;
	/** The last live envelope read in that epoch. */
	seq?: number;
	entry?: string;
}

export type Next =
	| { read: "now" }
	/** A daemon may send an envelope twice. */
	| { read: "skip" }
	| { read: "state"; why: "new" | "epoch" | "gap" };

export function decide(cursor: Cursor, envelope: Envelope): Next {
	if (cursor.epoch === undefined) return { read: "state", why: "new" };
	if (envelope.epoch !== undefined && envelope.epoch !== cursor.epoch) {
		return { read: "state", why: "epoch" };
	}
	if (envelope.seq !== undefined && cursor.seq !== undefined) {
		// A repeat changes nothing; a hole only the opening can fill.
		if (envelope.seq <= cursor.seq) return { read: "skip" };
		if (envelope.seq > cursor.seq + 1) return { read: "state", why: "gap" };
	}
	return { read: "now" };
}

export function advance(cursor: Cursor, envelope: Envelope): Cursor {
	return {
		...cursor,
		...(envelope.epoch === undefined ? {} : { epoch: envelope.epoch }),
		...(envelope.seq === undefined ? {} : { seq: envelope.seq }),
	};
}

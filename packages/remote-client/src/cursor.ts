// Where a client stopped reading: entries by pi's entry id, and the live stream by (epoch, seq). A
// cursor is what a reconnect sends.
import type { Envelope } from "@adeildo/pi-remote-protocol";

export interface Cursor {
	/** The life of the pi process the client was reading. */
	epoch?: string;
	/** The last live envelope the client read, in that epoch. */
	seq?: number;
	/** The last entry of the branch the client holds. */
	entry?: string;
}

export type Next =
	/** Read it: it comes after the cursor. */
	| { read: "now" }
	/** Already read, so nothing changes: a daemon is free to send an envelope twice. */
	| { read: "skip" }
	/** Read the snapshot first: the stream restarted, or the client is new. */
	| { read: "state"; why: "new" | "epoch" | "gap" };

/**
 * What to do with an envelope of a session the client already has. A new epoch always means a
 * snapshot, because the seq numbering started over. A hole in the numbering means the same, since
 * nothing else can put back what was dropped.
 */
export function decide(cursor: Cursor, envelope: Envelope): Next {
	if (cursor.epoch === undefined) return { read: "state", why: "new" };
	if (envelope.epoch !== undefined && envelope.epoch !== cursor.epoch) {
		return { read: "state", why: "epoch" };
	}
	if (envelope.seq !== undefined && cursor.seq !== undefined) {
		// At or behind the cursor is a repeat, which changes nothing; past the next number is a hole,
		// which nothing but the snapshot can put back.
		if (envelope.seq <= cursor.seq) return { read: "skip" };
		if (envelope.seq > cursor.seq + 1) return { read: "state", why: "gap" };
	}
	return { read: "now" };
}

/** The cursor after reading the envelope, which is what the next reconnect sends. */
export function advance(cursor: Cursor, envelope: Envelope): Cursor {
	return {
		...cursor,
		...(envelope.epoch === undefined ? {} : { epoch: envelope.epoch }),
		...(envelope.seq === undefined ? {} : { seq: envelope.seq }),
	};
}

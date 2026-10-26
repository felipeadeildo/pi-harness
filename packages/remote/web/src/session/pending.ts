// The outbox is what this device sent and the daemon has not answered; the queue is what the session
// holds. A message is never in both.

import type { QueuedMessage } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";

/** One line of the session's queue, ready to draw and to read in a test. */
export interface QueuedLine {
	id: string;
	/** What the line says the session is holding, cut so a wall of text cannot take the screen. */
	text: string;
	/** Who it is from, which is how a line from another machine is told apart from one's own. */
	by: string;
}

/** How much of a queued message a line shows before it is cut. */
export const QUEUED_CHARS = 80;

/** The queue as lines, in the order the session will run them. */
export function queuedLines(queue: readonly QueuedMessage[]): QueuedLine[] {
	return queue.map((message) => ({
		id: message.id,
		text:
			message.text.length > QUEUED_CHARS
				? `${message.text.slice(0, QUEUED_CHARS - 1)}…`
				: message.text,
		by: message.by.name,
	}));
}

/** Sends the id, since a `queue.clear` without ids empties everyone's queue. */
export function withdraw(client: Client, id: string): void {
	client.send("queue.clear", { ids: [id] });
}

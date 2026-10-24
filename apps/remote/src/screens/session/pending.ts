// Two lists wait on the same screen and they are not the same thing: the outbox is what this device
// sent and the daemon has not answered, the queue is what the session itself is holding for the agent
// to finish. A message moves from one to the other when the answer names it, and it is never in both.

import type { QueuedMessage } from "@adeildo/pi-remote-protocol";

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

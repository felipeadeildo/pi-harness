// The outbox is what this device sent and the daemon has not answered; the queue is what the session
// holds. A message is never in both.

import type { QueuedMessage } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";

export interface QueuedLine {
	id: string;
	/** Cut, so a wall of text cannot take the screen. */
	text: string;
	/** How a line from another machine is told apart. */
	by: string;
}

export const QUEUED_CHARS = 80;

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

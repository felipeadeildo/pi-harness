import type { EventScope } from "../contract.ts";
import { defineContract } from "../contract.ts";
import { type Decoder, type Problem, isObject, pass } from "../decode.ts";
import type { Letter } from "../inbox/letter.ts";
import { isLetter } from "../inbox/letter.ts";

/** Held follow-ups in delivery order, and the steers sent. */
export interface InboxState {
	queue: Letter[];
	sent: Letter[];
}

export interface InboxPort {
	put(letter: Letter): void;
	take(ids?: readonly string[]): Letter[];
}

const letterList: Decoder<Letter[]> = {
	decode(value) {
		if (!Array.isArray(value)) return refused("a list of letters");
		const letters = value.filter(isLetter);
		return letters.length === value.length ? pass(letters) : refused("a letter");
	},
};

const state: Decoder<InboxState> = {
	decode(value) {
		if (!isObject(value)) return refused("a queue and the steers sent");
		const queue = letterList.decode(value.queue, "queue");
		const sent = letterList.decode(value.sent, "sent");
		if (!queue.ok) return queue;
		if (!sent.ok) return sent;
		return pass({ queue: queue.value, sent: sent.value });
	},
};

function refused(message: string): { ok: false; problems: Problem[] } {
	return { ok: false, problems: [{ path: "", message }] };
}

/** `inbox` holds the queue; `inbox:port` puts a letter in or takes one back. */
export const INBOX = defineContract<InboxState>("inbox", state);
function isInboxPort(value: unknown): value is InboxPort {
	return isObject(value) && typeof value.put === "function" && typeof value.take === "function";
}

export const INBOX_PORT = defineContract<InboxPort>("inbox:port", {
	decode(value) {
		return isInboxPort(value) ? pass(value) : refused("an inbox port");
	},
});

export function inboxPort(scope: EventScope): InboxPort | undefined {
	return INBOX_PORT.current(scope);
}

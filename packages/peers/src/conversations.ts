// Who talks with whom in a room: its messages grouped by the people in them.
import { addressees, type Peer, type Posted, type RoomItem } from "./folder.ts";
import { award } from "./rules.ts";

export const YOU = "you";

export interface Conversation {
	key: string;
	room: string | undefined;
	/** In the order they first wrote or were written to; `YOU` is the operator. */
	parties: string[];
	audience?: "all" | "any";
	messages: Posted[];
}

export type Standing =
	| { kind: "sending"; to: string[] }
	| { kind: "unread"; by: string[] }
	| { kind: "read"; by: string[] }
	| { kind: "taken"; by: string }
	| { kind: "bidding" }
	| { kind: "busy" };

export function speakerOf(message: Posted): string {
	return message.from === "you" ? YOU : message.session;
}

export function conversationKey(room: string | undefined, message: Posted): string {
	const who =
		message.to === "all" || message.to === "any"
			? `${message.to}:${speakerOf(message)}`
			: [...new Set([speakerOf(message), ...message.to])].toSorted().join(",");
	return `${room ?? ""}/${who}`;
}

/** The newest first. */
export function conversationsIn(
	room: string | undefined,
	items: readonly RoomItem[],
): Conversation[] {
	const found = new Map<string, Conversation>();
	for (const item of items) {
		if (item.kind !== "message") continue;
		const message = item.message;
		const key = conversationKey(room, message);
		const known = found.get(key);
		if (known !== undefined) {
			known.messages.push(message);
			continue;
		}
		const group = message.to === "all" || message.to === "any" ? message.to : undefined;
		found.set(key, {
			key,
			room,
			parties: group === undefined ? [speakerOf(message), ...message.to] : [speakerOf(message)],
			...(group === undefined ? {} : { audience: group }),
			messages: [message],
		});
	}
	return [...found.values()].toSorted((a, b) => lastAt(b) - lastAt(a));
}

export function lastAt(conversation: Conversation): number {
	return conversation.messages.at(-1)?.at ?? 0;
}

export function bothWays(conversation: Conversation): boolean {
	if (conversation.audience !== undefined) return false;
	return new Set(conversation.messages.map(speakerOf)).size > 1;
}

export function standingOf(message: Posted, live: readonly Peer[], now: number): Standing {
	if (message.to === "any") {
		const ranking = award(message, live, now);
		if (ranking.kind === "taken") return { kind: "taken", by: ranking.by };
		if (ranking.kind === "waiting") return { kind: "busy" };
		return { kind: "bidding" };
	}
	const to = addressees(message, live);
	const open = new Set(live.map((peer) => peer.session));
	const sending = to.filter((session) => !message.received.has(session) && open.has(session));
	if (sending.length > 0 && message.to !== "all") return { kind: "sending", to: sending };
	const unread = to.filter((session) => !message.read.has(session));
	if (unread.length > 0) return { kind: "unread", by: unread };
	return { kind: "read", by: to };
}

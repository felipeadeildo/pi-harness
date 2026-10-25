// What the composer decides, apart from the views that show it: a phone draws with views, and a test
// cannot load them. The rules stay here, and the screen only wires them.
import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import type { CommandMap, CommandType } from "@adeildo/pi-remote-protocol";

/** Sends a held command now: it keeps its id, so the far side reads it as the same one. */
export function sendNow(client: Client, id: string): void {
	client.release(id);
}

/** Gives up on a held command: it leaves the queue and nothing goes out. */
export function dropNow(client: Client, id: string): void {
	client.drop(id);
}

/** What a command's state says to the person: to wait, to retry, or that it is done. */
export function stateOf(command: Outgoing): string {
	switch (command.state) {
		case "waiting":
			// Only a command that waited past the window reaches here: one inside it is said as
			// "goes out when the daemon answers" by the caller.
			return "waiting for you";
		case "sent":
			return "sent, no answer yet";
		case "applied":
			return "done";
		case "refused":
			return `refused: ${command.why ?? "the daemon said no"}`;
	}
}

/**
 * Whether a key press sends the draft. Enter is, Shift+Enter is not: the second is how a person writes
 * a second line in a field that has one, and swallowing it loses the line.
 */
export function enterSends(
	event: { key: string; shiftKey?: boolean; preventDefault?: () => void },
	take: () => void,
): boolean {
	if (event.key !== "Enter" || event.shiftKey === true) return false;
	event.preventDefault?.();
	take();
	return true;
}

/** Sends the draft and clears it, which is what both the button and Enter do. */
export function takeDraft(
	send: <K extends CommandType>(type: K, data: CommandMap[K]) => void,
	draft: string,
	clear: () => void,
	deliverAs: "steer" | "followUp",
): void {
	const text = draft.trim();
	if (text === "") return;
	send("prompt.send", { text, deliverAs });
	clear();
}

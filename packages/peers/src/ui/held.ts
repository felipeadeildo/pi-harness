// Colleagues' messages that wait for your next prompt, drawn when they arrive: the same frames as a
// delivery, and one line under them that says why the agent did not get them yet, or, once a run
// that was not yours took them, which run that was.
import { drawnByWidth, ENTRY_X } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Held, PeerDelivery } from "../inbox.ts";
import { CHAIN_LIMIT, STEERS_PER_RUN } from "../rules.ts";
import { deliveryBlock } from "./message.ts";

/** What the transcript keeps of a held delivery. */
export interface HeldDelivery extends PeerDelivery {
	why: Held;
}

/** A run that was not yours took the held messages: `by` started it, when a colleague did. */
export interface WentIn {
	by?: string;
}

/** `wentIn` is read on every frame, so the line changes once a run takes the messages. */
export function heldBlock(
	held: HeldDelivery,
	theme: Theme,
	wentIn: (id: string) => WentIn | undefined = () => undefined,
): Component {
	const frames = deliveryBlock(held, theme);
	return drawnByWidth((width) => [
		...frames.render(width),
		...wrapTextWithAnsi(
			heldLine(held, wentIn(held.items[0]?.id ?? "")),
			Math.max(1, width - ENTRY_X),
		).map((line) => `${" ".repeat(ENTRY_X)}${theme.fg("muted", line)}`),
	]);
}

export function heldLine(held: HeldDelivery, wentIn?: WentIn): string {
	const one = held.items.length === 1;
	if (wentIn !== undefined) {
		const went = one ? "It went in" : "They went in";
		return wentIn.by === undefined
			? `${went} with the next run, which you did not start.`
			: `${went} with the next run, which @${wentIn.by}'s message started.`;
	}
	const them = one ? "It waits" : "They wait";
	switch (held.why) {
		case "asleep":
			return `${them} for your first prompt in this session.`;
		case "quiet":
			return `${them} for your next prompt: the agents answered each other ${held.chain ?? CHAIN_LIMIT} times without you, which looks like a loop.`;
		case "full":
			return `${them} for your next prompt: this run already took ${STEERS_PER_RUN} messages from other agents.`;
		case "stopped":
			return `${them} for your next prompt: you stopped the run before the agent read ${one ? "it" : "them"}.`;
	}
}

// Colleagues' messages waiting for your next prompt, with why the agent has not got them yet.
import { drawnByWidth, CHANGES_X, type Held, isObject } from "@adeildo/pi-kit";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { PeerDelivery } from "../inbox.ts";
import { CHAIN_LIMIT, STEERS_PER_RUN } from "../rules.ts";
import { deliveryBlock } from "./message.ts";

export interface HeldDelivery extends PeerDelivery {
	why: Held;
}

export interface WentIn {
	by?: string;
	released?: true;
}

/** Out of the context, so a held line still says it went in after a reload. */
export const PEER_WENT_IN = "pi-peers:went-in";

export interface WentInEntry extends WentIn {
	ids: string[];
}

export function isWentIn(value: unknown): value is WentInEntry {
	if (!isObject(value) || !Array.isArray(value.ids)) return false;
	return (
		value.ids.every((id) => typeof id === "string") &&
		(value.by === undefined || typeof value.by === "string") &&
		(value.released === undefined || value.released === true)
	);
}

/** Read on every frame, so the line changes once a run takes the messages. */
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
			Math.max(1, width - CHANGES_X),
		).map((line) => `${" ".repeat(CHANGES_X)}${theme.fg("muted", line)}`),
	]);
}

function heldLine(held: HeldDelivery, wentIn?: WentIn): string {
	const one = held.items.length === 1;
	if (wentIn !== undefined) {
		const went = one ? "It went in" : "They went in";
		if (wentIn.released === true) return `${went} when you let ${one ? "it" : "them"} through.`;
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

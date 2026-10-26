import { type BoardCard, pointer, CUT, spread, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { doing, stateOf, waiting } from "../cards.ts";
import type { Peer } from "../folder.ts";
import type { Named } from "../names.ts";
import { spin } from "./motion.ts";

export const MARKS = { idle: GLYPH.diamondEmpty, waiting: GLYPH.flag } as const;

const CARD_LINES_OPEN = 4;
const CARD_LINES_CLOSED = 2;
const EDITED_SHOWN = 3;

export interface AgentsOptions {
	theme: Theme;
	now: number;
	me: string | undefined;
	selected: number;
	width: number;
	/** Bright while ↑↓ move it, dim while you write in the room. */
	focused?: boolean;
	/** For a narrow list. */
	compact?: boolean;
	indent?: number;
}

export function markOf(peer: Peer, color: ThemeColor, theme: Theme, now: number): string {
	switch (stateOf(peer)) {
		case "waiting":
			return theme.fg("warning", MARKS.waiting);
		case "running":
			return theme.fg(color, spin(now));
		case "idle":
			return theme.fg("dim", MARKS.idle);
	}
}

export function stateText(peer: Peer, theme: Theme, now: number): string {
	switch (stateOf(peer)) {
		case "waiting":
			return theme.fg("warning", "waits on you");
		case "running":
			return theme.fg("muted", `working ${since(peer.stateAt, now)}`);
		case "idle":
			return theme.fg("dim", "idle");
	}
}

function shortState(peer: Peer, theme: Theme, now: number): string {
	switch (stateOf(peer)) {
		case "waiting":
			return theme.fg("warning", "waits");
		case "running":
			return theme.fg("muted", since(peer.stateAt, now));
		case "idle":
			return "";
	}
}

/** This session last: it is the one you already know. */
export function inOrder(live: readonly Peer[], me: string | undefined): Peer[] {
	return [...live].toSorted((a, b) => Number(a.session === me) - Number(b.session === me));
}

export function agentLines(
	live: readonly Peer[],
	names: ReadonlyMap<string, Named>,
	options: AgentsOptions,
): { lines: string[]; selectedAt: number; selectedEnd: number } {
	const { theme, width, now } = options;
	if (live.length === 0)
		return {
			lines: [
				theme.fg("muted", "No other agent in this folder."),
				theme.fg("dim", "Start pi in another terminal here and it shows up."),
			],
			selectedAt: 0,
			selectedEnd: 0,
		};
	const lines: string[] = [];
	let selectedAt = 0;
	let selectedEnd = 0;
	const here = live.find((peer) => peer.session === options.me)?.cwd;
	const indent = " ".repeat(options.indent ?? 0);
	const compact = options.compact === true;
	for (const [index, peer] of live.entries()) {
		const named = names.get(peer.session);
		const color = (named?.color ?? "muted") as ThemeColor;
		const selected = index === options.selected;
		const marker = pointer(theme, selected, options.focused === true);
		const you = peer.session === options.me ? theme.fg("dim", "  you") : "";
		const name = theme.fg(color, theme.bold(named?.handle ?? "anon"));
		// An agent from another folder says which, since its files are there.
		const where =
			peer.cwd === undefined || here === undefined || peer.cwd === here
				? ""
				: theme.fg("dim", ` \u00b7 ${base(peer.cwd)}`);
		if (selected) selectedAt = lines.length;
		lines.push(
			`${indent}${spread(
				`${marker}${markOf(peer, color, theme, now)} ${name}${where}${you}`,
				compact ? shortState(peer, theme, now) : stateText(peer, theme, now),
				width - indent.length,
			)}`,
		);
		const room = width - indent.length - 4;
		const shown =
			compact && !selected ? glance(peer, theme, room) : details(peer, theme, room, selected);
		for (const line of shown) lines.push(`${indent}    ${line}`);
		if (selected) selectedEnd = lines.length;
		if (!compact && index < live.length - 1) lines.push("");
	}
	return { lines, selectedAt, selectedEnd };
}

/** The card wraps rather than being cut, since a cut title says nothing. */
function details(peer: Peer, theme: Theme, width: number, selected: boolean): string[] {
	const most = selected ? CARD_LINES_OPEN : CARD_LINES_CLOSED;
	const lines: string[] = [];
	const waits = waiting(peer);
	lines.push(...card(theme, waits, width, most, "warning"));
	if (selected || waits.length === 0) lines.push(...card(theme, doing(peer), width, most, "text"));
	const edited = [...peer.edited.keys()].slice(-EDITED_SHOWN).map(base);
	if (edited.length > 0)
		lines.push(theme.fg("dim", truncateToWidth(`edited ${edited.join(", ")}`, width, CUT)));
	if (selected && lines.length === 0) lines.push(theme.fg("dim", "nothing in progress"));
	return lines;
}

function glance(peer: Peer, theme: Theme, width: number): string[] {
	const waits = waiting(peer)[0];
	const first = waits ?? doing(peer)[0];
	if (first === undefined) return [];
	return [
		theme.fg(waits === undefined ? "dim" : "warning", truncateToWidth(first.title, width, CUT)),
	];
}

function card(
	theme: Theme,
	cards: readonly BoardCard[],
	width: number,
	most: number,
	tone: ThemeColor,
): string[] {
	const first = cards[0];
	if (first === undefined) return [];
	let lines = wrapTextWithAnsi(first.title, width);
	if (lines.length > most)
		lines = [
			...lines.slice(0, most - 1),
			truncateToWidth(lines.slice(most - 1).join(" "), width, CUT),
		];
	const out = lines.map((line) => theme.fg(tone, line));
	if (cards.length > 1) out.push(theme.fg("dim", `and ${cards.length - 1} more`));
	return out;
}

function since(at: number, now: number): string {
	const minutes = Math.max(0, Math.round((now - at) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	return `${Math.round(minutes / 60)}h`;
}

function base(path: string): string {
	return path.split("/").pop() ?? path;
}

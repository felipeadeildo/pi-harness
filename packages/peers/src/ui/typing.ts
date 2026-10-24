// Over the editor, while another agent writes to the room: who, to whom, and the words as they
// arrive. A draft has not happened yet, so it wears the dashed frame the send queue wears. Once sent
// to this agent, the frame stays and says when the agent gets it, until its model reads it and it
// lands in the chat.
import { basename } from "node:path";

import { ENTRY_X, entryFrame, formatClock, GLYPH } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Here } from "../here.ts";
import type { Waiting } from "../inbox.ts";
import { EVERYONE_MENTION } from "../mention.ts";
import type { Room, RoomTyping } from "../model.ts";
import { byHandle, type Named } from "../names.ts";
import { addressed } from "./message.ts";
import { dots, FRAME_MS, spin } from "./motion.ts";

export const PEERS_TYPING = "pi-peers-typing";

/**
 * A message waiting for the agent shows this many lines of its words. The frame over the editor is
 * this many lines plus the two dashed ones around them: a line added here changes the height the
 * tests pin, so the assertion and the constant move together.
 */
export const WAITING_SHOWN = 3;

const WHEN: Record<Waiting["mode"], string> = {
	steered: "between calls",
	"after-run": "after this run",
};

/** The drafts in every room, and each room's names, which only that room knows. */
export interface TypingSource {
	othersTyping(): RoomTyping[];
	/** What was sent to this agent and waits in its queue. */
	queued(): Waiting[];
	here(room: string | undefined): Pick<Here, "session" | "names"> | undefined;
	rooms(): Room[];
}

export function typingLines(
	typing: readonly RoomTyping[],
	source: TypingSource,
	theme: Theme,
	width: number,
	now: number,
): string[] {
	const rooms = new Map(source.rooms().map((room) => [room.id, room.name]));
	return typing.flatMap((one) => {
		const here = source.here(one.room);
		const names: ReadonlyMap<string, Named> = here?.names() ?? new Map();
		// A message to this session reads "to you".
		const me = here?.session === undefined ? undefined : names.get(here.session)?.handle;
		// A draft in a shared room says which, as the room's messages do.
		const name = one.room === undefined ? undefined : rooms.get(one.room);
		const where = name === undefined ? "" : theme.fg("dim", ` in ${name}`);
		const named = names.get(one.session);
		const color = (named?.color ?? "muted") as ThemeColor;
		// The newest words matter most while they arrive, so a long draft keeps its end.
		const words = one.text.replaceAll(/\s+/g, " ").trim();
		const room = Math.max(1, width - ENTRY_X - 4);
		const body =
			words === ""
				? []
				: [theme.fg("muted", words.length > room ? `...${words.slice(-room)}` : words)];
		return entryFrame(body, width, theme, {
			top: `${theme.fg(color, theme.bold(`@${named?.handle ?? "an agent"}`))}${theme.fg("dim", ` ${GLYPH.right} `)}${typingRecipients(one.to, names, theme, me)}${where}`,
			topRight: `${theme.fg(color, spin(now))} ${theme.fg("dim", `writing${dots(now)}`)}`,
			color,
			dashed: true,
		});
	});
}

/** Sent and not read yet: the draft's frame, with its first lines and when the agent gets it. */
export function waitingLines(waiting: readonly Waiting[], theme: Theme, width: number): string[] {
	return waiting.flatMap((one) => {
		const color = (one.fromYou ? "accent" : one.color) as ThemeColor;
		const where = one.where === undefined ? "" : theme.fg("dim", ` \u00b7 ${basename(one.where)}`);
		const body = firstLines(one.text, Math.max(1, width - ENTRY_X)).map((line) =>
			line.more ? theme.fg("dim", line.text) : theme.fg("muted", line.text),
		);
		return entryFrame(body, width, theme, {
			top: `${theme.fg(color, theme.bold(`@${one.from}`))}${where} ${theme.fg("dim", addressed(one))}`,
			topRight: `${theme.fg("muted", WHEN[one.mode])} ${theme.fg("dim", formatClock(one.at))}`,
			color,
			dashed: true,
		});
	});
}

/** The first lines with words, and how many more there are when they do not all fit. */
function firstLines(text: string, width: number): { text: string; more: boolean }[] {
	const words = wrapTextWithAnsi(text.trim(), width).filter((line) => line.trim() !== "");
	if (words.length <= WAITING_SHOWN) return words.map((line) => ({ text: line, more: false }));
	const shown = words.slice(0, WAITING_SHOWN - 1).map((line) => ({ text: line, more: false }));
	return [...shown, { text: `${words.length - WAITING_SHOWN + 1} more lines`, more: true }];
}

/** Redraws itself every frame while someone writes; pi drops it when nobody does. */
export class TypingWidget implements Component {
	readonly #source: TypingSource;
	readonly #theme: Theme;
	readonly #ticks: ReturnType<typeof setInterval>;

	constructor(source: TypingSource, theme: Theme, requestRender: () => void) {
		this.#source = source;
		this.#theme = theme;
		this.#ticks = setInterval(requestRender, FRAME_MS);
	}

	render(width: number): string[] {
		// What already arrived sits over what is still being written, which is the newest.
		return [
			...waitingLines(this.#source.queued(), this.#theme, width),
			...typingLines(this.#source.othersTyping(), this.#source, this.#theme, width, Date.now()),
		];
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.#ticks);
	}
}

/** Who a draft goes to, each in its color; `me` reads "you". */
export function typingRecipients(
	to: string,
	names: ReadonlyMap<string, Named>,
	theme: Theme,
	me?: string,
): string {
	if (to === EVERYONE_MENTION) return theme.fg("muted", EVERYONE_MENTION);
	return to
		.split(",")
		.map((part) => part.trim().replace(/^@/, ""))
		.filter((handle) => handle !== "")
		.map((handle) => {
			if (handle === me) return theme.fg("accent", "you");
			const named = byHandle(names, handle);
			return theme.fg((named?.color ?? "muted") as ThemeColor, `@${handle}`);
		})
		.join(theme.fg("dim", ", "));
}

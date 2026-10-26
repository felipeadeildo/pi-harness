// Over the editor while another agent writes to the room, in the send queue's dashed frame.
import { basename } from "node:path";

import { CHANGES_X, entryFrame, formatClock } from "@adeildo/pi-kit";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { Here } from "../here.ts";
import type { Waiting } from "../inbox.ts";
import { EVERYONE_MENTION } from "../mention.ts";
import type { Room, RoomTyping } from "../model.ts";
import { type Named } from "../names.ts";
import { addressed } from "./message.ts";
import { FRAME_MS } from "./motion.ts";

export const PEERS_TYPING = "pi-peers-typing";

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

/** Who is writing, to whom, in one line the footer draws: the frame over the editor is only for what waits here. */
export interface WritingMark {
	handle: string;
	color: string;
	to: string;
}

export function writingMarks(
	typing: readonly RoomTyping[],
	source: Pick<TypingSource, "here">,
): WritingMark[] {
	return typing.map((one) => {
		const here = source.here(one.room);
		const names: ReadonlyMap<string, Named> = here?.names().bySession ?? new Map();
		const me = here?.session === undefined ? undefined : names.get(here.session)?.handle;
		const named = names.get(one.session);
		return {
			handle: named?.handle ?? "an agent",
			color: named?.color ?? "muted",
			to: plainRecipients(one.to, names, me),
		};
	});
}

/** The same names the frame uses, without the theme: `you` for this session, `@handle` for the rest. */
function plainRecipients(to: string, names: ReadonlyMap<string, Named>, me: string | undefined) {
	if (to === EVERYONE_MENTION) return "everyone";
	return to
		.split(",")
		.map((part) => part.trim().replace(/^@/, ""))
		.filter((handle) => handle !== "")
		.map((handle) => (handle === me ? "you" : `@${handle}`))
		.join(", ");
}

/** Sent and not read yet: the draft's frame, with its first lines and when the agent gets it. */
export function waitingLines(waiting: readonly Waiting[], theme: Theme, width: number): string[] {
	return waiting.flatMap((one) => {
		const color = (one.fromYou ? "accent" : one.color) as ThemeColor;
		const where = one.where === undefined ? "" : theme.fg("dim", ` \u00b7 ${basename(one.where)}`);
		const body = firstLines(one.text, Math.max(1, width - CHANGES_X)).map((line) =>
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
		// Only what waits for this session: another agent's draft is not addressed here, and a frame
		// over the editor for something not meant for you would move the editor you are typing in.
		return waitingLines(this.#source.queued(), this.#theme, width);
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
			const named = [...names.values()].find((one) => one.handle === handle);
			return theme.fg((named?.color ?? "muted") as ThemeColor, `@${handle}`);
		})
		.join(theme.fg("dim", ", "));
}

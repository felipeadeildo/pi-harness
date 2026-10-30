// The peers tool in the calling agent's chat: the message, then what became of it.
import { CUT, GLYPH } from "@adeildo/pi-kit";
import type { Delivery } from "@adeildo/pi-kit";
import type { AgentToolResult, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { addressees, type Posted } from "../folder.ts";
import type { Here } from "../here.ts";
import type { SentDetails } from "../index.ts";
import { ANYONE_MENTION, EVERYONE_MENTION } from "../mention.ts";
import { award } from "../rules.ts";

const BAR_CELLS = 5;
/** A message nobody logged after this stops spinning. */
const ON_ITS_WAY_MS = 60_000;

interface Args {
	action?: string;
	to?: string;
	text?: string;
	urgent?: boolean;
	room?: string;
	folder?: string;
}

interface Row {
	toolCallId: string;
	argsComplete: boolean;
	invalidate(): void;
	state: RowState;
	lastComponent?: Component;
}

interface RowState {
	tick?: ReturnType<typeof setTimeout>;
}

export type Source = Pick<Here, "session" | "folder" | "live" | "names">;

export interface Places {
	here(room: string | undefined): Source | undefined;
	rooms(): readonly { id: string | undefined; name: string }[];
}

const CURSOR = GLYPH.bar;
const INDENT = "  ";
const GAP = "   ";
/** Once a second: enough for a countdown, cheap in a long transcript. */
const TICK_MS = 1_000;

const EVERYONE = new Set([EVERYONE_MENTION, "all", "room"]);
const ANYONE = new Set([ANYONE_MENTION, "any"]);

const ARRIVED: Record<Delivery, string> = {
	woke: "woke it",
	"after-run": "gets it after its run",
	steered: "cut into its run",
	"next-turn": "gets it with the next prompt",
};

type Stage = "read" | "got" | "sending" | "sent";
const STAGES: readonly Stage[] = ["read", "got", "sending", "sent"];

export function audienceOf(to: string | undefined): "all" | "any" | string[] {
	const wanted = (to ?? EVERYONE_MENTION)
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	if (wanted.some((name) => EVERYONE.has(name.toLowerCase()))) return "all";
	if (wanted.some((name) => ANYONE.has(name.toLowerCase()))) return "any";
	return wanted;
}

// Pi hands each drawing a new `row` that holds the component drawn before it, so components keep
// only the row's state and the last one drawn is updated, not replaced.
export function toolRenderers(places: Places, rows: Map<string, () => void>) {
	return {
		renderCall: (args: Args, theme: Theme, row: Row): Component => {
			const last = row.lastComponent;
			if (last instanceof CallRow) return last.update(args, theme, row.argsComplete);
			return new CallRow(places).update(args, theme, row.argsComplete);
		},
		renderResult: (
			result: AgentToolResult<SentDetails | undefined>,
			options: { expanded: boolean },
			theme: Theme,
			row: Row,
		): Component => {
			// Pi builds the row again when it redraws the chat, and the new row's redraw replaces the old.
			if (result.details !== undefined) rows.set(row.toolCallId, row.invalidate);
			const last = row.lastComponent;
			const drawn =
				last instanceof ResultRow ? last : new ResultRow(places, row.state, row.invalidate);
			return drawn.update(result, options.expanded, theme);
		},
	};
}

class CallRow implements Component {
	#args: Args = {};
	#theme: Theme | undefined;
	#complete = false;
	#drawn: { width: number; lines: string[] } | undefined;

	constructor(private readonly places: Places) {}

	update(args: Args, theme: Theme, complete: boolean): this {
		this.#args = args;
		this.#theme = theme;
		this.#complete = complete;
		this.#drawn = undefined;
		return this;
	}

	render(width: number): string[] {
		if (this.#theme === undefined) return [];
		if (this.#drawn?.width !== width) {
			const shown = placeOf(this.places, this.#args.room);
			const lines = callLines(shown, this.#args, this.#theme, width, !this.#complete);
			this.#drawn = { width, lines };
		}
		return this.#drawn.lines;
	}

	invalidate(): void {
		this.#drawn = undefined;
	}
}

/** Lines are kept until the room changes, the second turns or the width does. */
class ResultRow implements Component {
	#result: AgentToolResult<SentDetails | undefined> | undefined;
	#expanded = false;
	#theme: Theme | undefined;
	#drawn: { here: Source | undefined; key: string; lines: string[] } | undefined;

	constructor(
		private readonly places: Places,
		private readonly state: RowState,
		private readonly redraw: () => void,
	) {}

	update(result: AgentToolResult<SentDetails | undefined>, expanded: boolean, theme: Theme): this {
		if (result !== this.#result || expanded !== this.#expanded || theme !== this.#theme)
			this.#drawn = undefined;
		this.#result = result;
		this.#expanded = expanded;
		this.#theme = theme;
		return this;
	}

	render(width: number): string[] {
		const result = this.#result;
		if (result === undefined || this.#theme === undefined) return [];
		const now = Date.now();
		const here = this.places.here(result.details?.room);
		const key = `${width}:${here?.folder.version ?? -1}:${Math.floor(now / TICK_MS)}`;
		const drawn = this.#drawn;
		if (drawn !== undefined && drawn.here === here && drawn.key === key) return drawn.lines;
		const message =
			result.details === undefined ? undefined : here?.folder.messages.get(result.details.id);
		if (here !== undefined && message !== undefined && moving(here, message, now)) this.#tick();
		const lines = resultLines(here, result, this.#expanded, this.#theme, width, now);
		this.#drawn = { here, key, lines };
		return lines;
	}

	invalidate(): void {
		this.#drawn = undefined;
	}

	/** The folder only says when something arrives; a countdown needs the clock. */
	#tick(): void {
		if (this.state.tick !== undefined) return;
		this.state.tick = setTimeout(() => {
			this.state.tick = undefined;
			this.redraw();
		}, TICK_MS);
	}
}

function placeOf(places: Places, room: string | undefined): Shown {
	const shared =
		room === undefined ? undefined : places.rooms().find((place) => place.name === room);
	const here = places.here(shared?.id);
	return here === undefined ? undefined : { here, room: shared?.name };
}

type Shown = { here: Source; room: string | undefined } | undefined;

export function callLines(
	shown: Shown,
	args: Args,
	theme: Theme,
	width: number,
	writing: boolean,
): string[] {
	if (args.action === "link")
		return [
			theme.fg("muted", `ask to talk to the agents open in ${args.folder ?? "another folder"}`),
		];
	if (args.action !== "send") return [theme.fg("muted", "read the board")];
	const urgent = args.urgent === true ? theme.fg("warning", `  ${GLYPH.flag} urgent`) : "";
	const where = shown?.room === undefined ? "" : theme.fg("dim", `  in ${shown.room}`);
	const lines = [
		truncateToWidth(
			`${theme.fg("muted", GLYPH.right)} ${addressLine(shown?.here, audienceOf(args.to), theme)}${where}${urgent}`,
			width,
			CUT,
		),
	];
	const text = `${args.text ?? ""}${writing ? theme.fg("accent", CURSOR) : ""}`;
	for (const line of wrapTextWithAnsi(text, Math.max(1, width - INDENT.length)))
		lines.push(INDENT + theme.fg("text", line));
	return lines;
}

function addressLine(here: Source | undefined, to: "all" | "any" | string[], theme: Theme): string {
	if (to === "all" || to === "any") {
		const group = theme.fg(
			"accent",
			theme.bold(`@${to === "all" ? EVERYONE_MENTION : ANYONE_MENTION}`),
		);
		const others =
			here
				?.live()
				.filter((peer) => peer.session !== here.session && (to === "all" || peer.prompted === true))
				.length ?? 0;
		return `${group}  ${theme.fg("dim", audienceNote(to, others))}`;
	}
	const names = [...(here?.names().bySession.values() ?? [])];
	return to
		.map((name) => {
			const named = names.find((candidate) => candidate.handle === name.replace(/^@/, ""));
			return named === undefined
				? theme.fg("text", name)
				: theme.fg(named.color as ThemeColor, theme.bold(named.handle));
		})
		.join(theme.fg("muted", ", "));
}

function audienceNote(to: "all" | "any", others: number): string {
	if (others === 0) return "nobody else is here yet";
	const agents = others === 1 ? "1 agent" : `${others} agents`;
	if (to === "any") return `${agents} bid, the best fit takes it`;
	return others === 1 ? "1 agent gets it" : `${agents} get it`;
}

export function resultLines(
	here: Source | undefined,
	result: AgentToolResult<SentDetails | undefined>,
	expanded: boolean,
	theme: Theme,
	width: number,
	now: number,
): string[] {
	const details = result.details;
	if (details === undefined) {
		const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
		const lines = text.split("\n");
		return (expanded ? lines : lines.slice(0, 1)).map((line) =>
			truncateToWidth(theme.fg("muted", line), width, CUT),
		);
	}
	const message = here?.folder.messages.get(details.id);
	if (here === undefined || message === undefined) return [theme.fg("dim", `${GLYPH.check} sent`)];
	const receipts = new Receipts(here, message, theme, now);
	if (message.to === "any") return receipts.request(width);
	if (message.to === "all" && !expanded) return receipts.fanOut(width);
	return receipts.each().map((line) => truncateToWidth(line, width, CUT));
}

function moving(here: Source, message: Posted, now: number): boolean {
	if (message.to === "any") {
		const kind = award(message, here.live(), now).kind;
		return kind === "bidding" || kind === "ranked";
	}
	if (now - message.at >= ON_ITS_WAY_MS) return false;
	return addressees(message, here.live()).some(
		(session) => stageOf(here, message, session, now) === "sending",
	);
}

function stageOf(here: Source, message: Posted, session: string, now: number): Stage {
	if (message.read.has(session)) return "read";
	if (message.received.has(session)) return "got";
	const open = here.live().some((peer) => peer.session === session);
	return open && now - message.at < ON_ITS_WAY_MS ? "sending" : "sent";
}

class Receipts {
	readonly #here: Source;
	readonly #message: Posted;
	readonly #theme: Theme;
	readonly #now: number;

	constructor(here: Source, message: Posted, theme: Theme, now: number) {
		this.#here = here;
		this.#message = message;
		this.#theme = theme;
		this.#now = now;
	}

	each(): string[] {
		const theme = this.#theme;
		const message = this.#message;
		return this.#addressees().map((session) => {
			const who = this.#name(session);
			const stage = stageOf(this.#here, message, session, this.#now);
			switch (stage) {
				case "read":
					return `${this.#ticks(stage)} ${who} ${theme.fg("muted", "read it")}`;
				case "got": {
					const mode = message.received.get(session)?.mode ?? "woke";
					return `${this.#ticks(stage)} ${who} ${theme.fg("muted", ARRIVED[mode])}`;
				}
				case "sending":
					return `${this.#ticks(stage)} ${who} ${theme.fg("dim", "on its way")}`;
				case "sent":
					return `${this.#ticks(stage)} ${who} ${theme.fg("dim", "sent")}`;
			}
		});
	}

	fanOut(width: number): string[] {
		const theme = this.#theme;
		const to = this.#addressees();
		if (to.length === 0)
			return [theme.fg("dim", `${GLYPH.check} sent, nobody else is here to get it`)];
		const reached = to
			.map((session) => ({
				session,
				stage: stageOf(this.#here, this.#message, session, this.#now),
			}))
			.toSorted((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
		const chips = reached.map(
			({ session, stage }) => `${this.#name(session)} ${this.#ticks(stage)}`,
		);
		return [
			truncateToWidth(this.#tally(reached.map(({ stage }) => stage)), width, CUT),
			...flow(chips, width - INDENT.length).map((line) => INDENT + line),
		];
	}

	request(width: number): string[] {
		const theme = this.#theme;
		const message = this.#message;
		const live = this.#here.live();
		const ranking = award(message, live, this.#now);
		// Sessions the operator has not written in yet do not bid.
		const candidates = live
			.filter((peer) => peer.prompted === true)
			.map((peer) => peer.session)
			.filter((session) => session !== message.session || message.from === "you");
		let status: string;
		switch (ranking.kind) {
			case "taken":
				status = `${theme.fg("success", `${GLYPH.check}${GLYPH.check}`)} ${this.#name(ranking.by)} ${theme.fg("muted", "took it")}`;
				break;
			case "bidding": {
				const left = Math.max(1, Math.ceil((ranking.until - this.#now) / 1_000));
				const bid = candidates.filter((session) => message.bids.has(session)).length;
				status = `${theme.fg("accent", GLYPH.diamondEmpty)} ${theme.fg("text", `${bid} of ${candidates.length} bid`)}${theme.fg("dim", `, bids close in ${left}s`)}`;
				break;
			}
			case "waiting":
				status = `${theme.fg("warning", GLYPH.flag)} ${theme.fg("muted", "everyone is busy, the first to finish takes it")}`;
				break;
			case "ranked": {
				const next = ranking.order[0];
				status =
					next === undefined
						? theme.fg("dim", "nobody in line")
						: `${theme.fg("accent", GLYPH.diamond)} ${this.#name(next)} ${theme.fg("muted", "is taking it")}`;
				break;
			}
		}
		const bids = [...message.bids]
			.filter(
				([session, bid]) => candidates.includes(session) && (bid.idle || ranking.kind !== "taken"),
			)
			.toSorted(([, a], [, b]) => Number(b.idle) - Number(a.idle) || b.fit - a.fit)
			.map(([session, bid]) => {
				const who = this.#name(session);
				if (!bid.idle) return `${who} ${theme.fg("dim", "busy")}`;
				const color = (this.#here.names().bySession.get(session)?.color ?? "muted") as ThemeColor;
				return `${who} ${bar(bid.fit, color, theme)} ${theme.fg("dim", fit(bid.fit))}`;
			});
		if (ranking.kind === "bidding")
			for (const session of candidates)
				if (!message.bids.has(session))
					bids.push(`${this.#name(session)} ${theme.fg("dim", "thinking")}`);
		return [
			truncateToWidth(status, width, CUT),
			...flow(bids, width - INDENT.length).map((line) => INDENT + line),
		];
	}

	/** Lit only when every agent read it, as a group chat shows it. */
	#tally(stages: readonly Stage[]): string {
		const theme = this.#theme;
		const count = (stage: Stage) => stages.filter((one) => one === stage).length;
		const slowest = stages.at(-1) ?? "sent";
		const read = count("read");
		if (read === stages.length) {
			const words = read === 1 ? "read it" : `all ${read} read it`;
			return `${this.#ticks("read")} ${theme.fg("text", words)}`;
		}
		const rest = [
			[count("got"), "got it"],
			[count("sending"), "on its way"],
			[count("sent"), "sent"],
		] as const;
		const parts = rest.filter(([n]) => n > 0).map(([n, words]) => theme.fg("dim", `${n} ${words}`));
		return [
			`${this.#ticks(slowest)} ${theme.fg("text", `${read} of ${stages.length} read`)}`,
			...parts,
		].join(theme.fg("dim", ", "));
	}

	#addressees(): string[] {
		return addressees(this.#message, this.#here.live());
	}

	#ticks(stage: Stage): string {
		const theme = this.#theme;
		const two = `${GLYPH.check}${GLYPH.check}`;
		switch (stage) {
			case "read":
				return theme.fg("accent", two);
			case "got":
				return theme.fg("muted", two);
			case "sending":
			case "sent":
				return theme.fg("dim", GLYPH.check);
		}
	}

	#name(session: string): string {
		const named = this.#here.names().bySession.get(session);
		const handle = named?.handle ?? this.#here.folder.peers.get(session)?.handle ?? "gone";
		return this.#theme.fg((named?.color ?? "muted") as ThemeColor, handle);
	}
}

function flow(parts: readonly string[], width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const part of parts) {
		const next = line === "" ? part : `${line}${GAP}${part}`;
		if (line !== "" && visibleWidth(next) > width) {
			lines.push(line);
			line = part;
		} else line = next;
	}
	if (line !== "") lines.push(line);
	return lines.map((one) => truncateToWidth(one, Math.max(1, width), CUT));
}

function bar(value: number, color: ThemeColor, theme: Theme): string {
	const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(value * BAR_CELLS)));
	return (
		theme.fg(color, GLYPH.barFull.repeat(filled)) +
		theme.fg("dim", GLYPH.barEmpty.repeat(BAR_CELLS - filled))
	);
}

function fit(value: number): string {
	return value >= 1 ? "1.0" : value.toFixed(2).replace(/^0/, "");
}

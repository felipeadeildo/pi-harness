import { execFile } from "node:child_process";
import { hostname } from "node:os";

import { createApp, defineFeature, type FeatureScope } from "@adeildo/pi-kit";
import type {
	ContextUsage,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { StatuslineFooter, type StatuslineSource } from "./footer.ts";
import {
	emptyData,
	type GitState,
	type SegmentOptions,
	type SessionData,
	type TurnData,
} from "./segments.ts";
import {
	gauge,
	icons,
	pathLength,
	preset,
	separator,
	STATUSLINE_SETTINGS,
	statuses,
} from "./settings.ts";
import {
	cacheHitPercent,
	emptyTotals,
	generationMsOf,
	TURN_ENTRY,
	type Totals,
	totalsOf,
	type TurnRecord,
} from "./totals.ts";

export {
	emptyData,
	gaugeBar,
	count,
	duration,
	shortenPath,
	renderParts,
	PLAIN,
	type SessionData,
} from "./segments.ts";
export { PRESETS } from "./presets.ts";
export { renderLine, renderLines, SEPARATORS } from "./line.ts";
export { cacheHitPercent, emptyTotals, totalsOf, type Totals } from "./totals.ts";

const TICK_MS = 1000;

/** What the session is doing right now. The footer reads it, the events move it. */
interface Live {
	ctx: ExtensionContext | undefined;
	startedAt: number | undefined;
	endedAt: number | undefined;
	firstTokenAt: number | undefined;
	firstTokenMs: number | undefined;
	rate: number | undefined;
	/** What the answer being written, or the last one, used. */
	usage: Totals;
	/** Read by asking git, which is why it is cached and refreshed, never read in a render. */
	git: GitState | undefined;
	probing: boolean;
	repaint: (() => void) | undefined;
	ticker: ReturnType<typeof setInterval> | undefined;
}

export const statusline = defineFeature({
	id: "statusline",
	description:
		"A dense footer: where you are, what the session costs, and how fast the model answers",
	settings: STATUSLINE_SETTINGS,
	setup(scope) {
		const live: Live = {
			ctx: undefined,
			startedAt: undefined,
			endedAt: undefined,
			firstTokenAt: undefined,
			firstTokenMs: undefined,
			rate: undefined,
			usage: emptyTotals(),
			git: undefined,
			probing: false,
			repaint: undefined,
			ticker: undefined,
		};

		const source: StatuslineSource = {
			data: (input) => dataOf(live, input),
			options: () => optionsOf(scope),
			preset: () => preset.get(scope),
			separator: () => separator.get(scope),
			attach: (repaint) => {
				live.repaint = repaint;
			},
		};

		// A setting changed, here or in the shared file, so the line is drawn again.
		for (const entry of STATUSLINE_SETTINGS) entry.listen(scope, () => live.repaint?.());

		// A command the agent ran may have moved the branch or left the tree dirty.
		scope.on("agent_settled", () => void probeGit(live));

		scope.onSessionStart((ctx) => {
			live.ctx = ctx;
			void probeGit(live);
			if (ctx.mode !== "tui") return;
			ctx.ui.setFooter(
				(tui, theme, footerData) => new StatuslineFooter(tui, theme, footerData, source),
			);
		});

		scope.onShutdown(() => {
			stopTicking(live);
			live.ctx?.ui.setFooter(undefined);
			live.ctx = undefined;
			live.repaint = undefined;
		});

		scope.on("message_start", () => {
			live.startedAt = Date.now();
			live.endedAt = undefined;
			live.firstTokenAt = undefined;
			live.rate = undefined;
			live.usage = emptyTotals();
			startTicking(live);
		});

		// The first piece of an answer is what the time to first token measures.
		scope.on("message_update", (event) => {
			if (event.message.role !== "assistant") return;
			live.usage = totalsOf([assistantEntry(event.message)]);
			if (live.firstTokenAt !== undefined) return;
			if (!event.assistantMessageEvent.type.endsWith("_delta")) return;
			live.firstTokenAt = Date.now();
			live.firstTokenMs = live.firstTokenAt - (live.startedAt ?? live.firstTokenAt);
		});

		scope.on("message_end", (event) => {
			if (event.message.role !== "assistant" || live.startedAt === undefined) return;

			const ended = Date.now();
			const output = event.message.usage.output;
			const from = live.firstTokenAt ?? live.startedAt;
			live.usage = totalsOf([assistantEntry(event.message)]);
			live.rate = output > 0 && ended > from ? output / ((ended - from) / 1000) : undefined;
			live.endedAt = ended;
			stopTicking(live);

			// Kept in the session, so the session speed is right after a resume and the usage ledger
			// gets a duration, which pi does not record.
			scope.appendEntry(TURN_ENTRY, {
				output,
				firstTokenMs: live.firstTokenMs ?? ended - live.startedAt,
				generationMs: ended - from,
			} satisfies TurnRecord);
			live.repaint?.();
		});
	},
});

/**
 * `git status --porcelain=v2 --branch` answers all three questions in one call: the upstream
 * distance and whether anything changed.
 */
function readGit(cwd: string): Promise<GitState | undefined> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["-C", cwd, "status", "--porcelain=v2", "--branch"],
			{ timeout: 2000 },
			(error, stdout) => {
				if (error !== null) {
					resolve(undefined);
					return;
				}

				let ahead = 0;
				let behind = 0;
				let dirty = false;
				for (const line of stdout.split("\n")) {
					if (line.startsWith("# branch.ab")) {
						const [, aheadPart, behindPart] = line.split(/\s+/);
						ahead = Math.abs(Number(aheadPart ?? "0"));
						behind = Math.abs(Number(behindPart ?? "0"));
					} else if (line !== "" && !line.startsWith("#")) {
						dirty = true;
					}
				}
				resolve({ ahead, behind, dirty });
			},
		);
	});
}

/** Only one at a time, and never while a render is waiting on it. */
async function probeGit(live: Live): Promise<void> {
	const ctx = live.ctx;
	if (ctx === undefined || live.probing) return;

	live.probing = true;
	try {
		live.git = await readGit(ctx.cwd);
		live.repaint?.();
	} finally {
		live.probing = false;
	}
}

/** The answer being written, or the last one when nothing is running. */
function turnOf(live: Live, model: SessionData["model"]): TurnData | undefined {
	const started = live.startedAt ?? live.endedAt;
	if (started === undefined) return undefined;
	return {
		running: live.startedAt !== undefined && model !== undefined,
		elapsedMs: Date.now() - started,
		usage: live.usage,
	};
}

/** Pi hands whole messages around, and the totals only want the ones that carry usage. */
function assistantEntry(message: unknown): SessionEntry {
	return { type: "message", message } as unknown as SessionEntry;
}

function contextOf(context: ContextUsage | undefined): SessionData["context"] {
	if (context === undefined) return undefined;
	const { percent, tokens } = context;
	if (percent === null || tokens === null) return undefined;
	return { percent, tokens, contextWindow: context.contextWindow };
}

function optionsOf(scope: FeatureScope): SegmentOptions {
	return {
		pathLength: pathLength.get(scope),
		statuses: statuses.get(scope),
		gauge: gauge.get(scope),
		icons: icons.get(scope),
	};
}

function dataOf(
	live: Live,
	input: { branch: string | null; statuses: readonly string[] },
): SessionData {
	const ctx = live.ctx;
	if (ctx === undefined) return emptyData();

	const model = ctx.model;
	const context = ctx.getContextUsage();
	const entries = ctx.sessionManager.getEntries();

	return {
		...emptyData(),
		cwd: ctx.cwd,
		home: process.env.HOME ?? process.env.USERPROFILE,
		branch: input.branch,
		host: hostname().split(".")[0],
		sessionName: ctx.sessionManager.getSessionName(),
		model:
			model === undefined
				? undefined
				: {
						id: model.id,
						name: model.name ?? model.id,
						// The name the provider wants, which is capitalised, not the id pi routes by.
						provider: ctx.modelRegistry.getProviderDisplayName(model.provider),
						reasoning: model.reasoning,
					},
		thinking: ctx.thinkingLevel,
		context: contextOf(context),
		git: live.git,
		totals: totalsOf(entries),
		cacheHit: cacheHitPercent(entries),
		rate: live.rate,
		firstTokenMs: live.firstTokenMs,
		turn: turnOf(live, model),
		generationMs: generationMsOf(entries),
		statuses: input.statuses,
		subscription: model === undefined ? false : ctx.modelRegistry.isUsingOAuth(model),
	};
}

/** The elapsed time has to move on its own, because nothing else happens while the model thinks. */
function startTicking(live: Live): void {
	stopTicking(live);
	live.ticker = setInterval(() => live.repaint?.(), TICK_MS);
	live.ticker.unref?.();
}

function stopTicking(live: Live): void {
	if (live.ticker === undefined) return;
	clearInterval(live.ticker);
	live.ticker = undefined;
}

export default function piStatusline(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-statusline" }).use(statusline).build();
}

import { hostname } from "node:os";

import { createApp, defineFeature, type FeatureScope } from "@adeildo/pi-kit";
import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { StatuslineFooter, type StatuslineSource } from "./footer.ts";
import { emptyData, type SegmentOptions, type SessionData } from "./segments.ts";
import {
	gauge,
	icons,
	pathLength,
	preset,
	separator,
	STATUSLINE_SETTINGS,
	statuses,
} from "./settings.ts";
import { cacheHitPercent, totalsOf } from "./totals.ts";

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
	firstTokenAt: number | undefined;
	firstTokenMs: number | undefined;
	rate: number | undefined;
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
			firstTokenAt: undefined,
			firstTokenMs: undefined,
			rate: undefined,
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

		scope.onSessionStart((ctx) => {
			live.ctx = ctx;
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
			live.firstTokenAt = undefined;
			startTicking(live);
		});

		// The first piece of an answer is what the time to first token measures.
		scope.on("message_update", (event) => {
			if (live.firstTokenAt !== undefined) return;
			if (!event.assistantMessageEvent.type.endsWith("_delta")) return;
			live.firstTokenAt = Date.now();
			live.firstTokenMs = live.firstTokenAt - (live.startedAt ?? live.firstTokenAt);
		});

		scope.on("message_end", (event) => {
			const ended = Date.now();
			const output = event.message.role === "assistant" ? event.message.usage.output : 0;
			const from = live.firstTokenAt ?? live.startedAt;
			live.rate =
				output > 0 && from !== undefined && ended > from
					? output / ((ended - from) / 1000)
					: undefined;
			live.startedAt = undefined;
			stopTicking(live);
			live.repaint?.();
		});
	},
});

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
						provider: model.provider,
						reasoning: model.reasoning,
					},
		thinking: ctx.thinkingLevel,
		context: contextOf(context),
		totals: totalsOf(entries),
		cacheHit: cacheHitPercent(entries),
		rate: live.rate,
		firstTokenMs: live.firstTokenMs,
		workingMs: live.startedAt === undefined ? undefined : Date.now() - live.startedAt,
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

import {
	answerGoal,
	applyGoalOps,
	createApp,
	defineFeature,
	emptyGoal,
	GOAL_CHANGED,
	GOAL_ENTRY,
	GOAL_STATE,
	GOAL_VERSION,
	type GoalOp,
	type GoalSource,
	type GoalTrigger,
	type GoalUpdate,
	goalFromEntries,
	nowOf,
	oneAtATime,
	type SessionGoal,
} from "@adeildo/pi-kit";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { modelsFor } from "./model.ts";
import { registerScreen } from "./screen.ts";
import { GOAL_SETTINGS, interval, model, SECTIONS } from "./settings.ts";
import { propose, type Proposal, tidy } from "./updater.ts";
import { lastMessage, workSince } from "./work.ts";

/** The status key, which the look's goal segment draws in its own place. */
export const GOAL_STATUS = "pi-goal";

export interface GoalKeeper {
	state(): SessionGoal;
	/** Applies operations and records them as one update. False when nothing changed. */
	apply(ops: readonly GoalOp[], trigger: GoalTrigger, extra?: ApplyExtra): boolean;
}

interface ApplyExtra {
	proposal?: Proposal;
	/** The entry the change happened at. */
	entry?: string;
	covers?: GoalUpdate["covers"];
}

/** Where the updates during a run stand. */
interface Pace {
	working: boolean;
	lastWork: number;
	workTimer?: ReturnType<typeof setTimeout>;
}

export const goal = defineFeature({
	id: "goal",
	tab: "Goal",
	description: "Keeps the session's goal, the current step, what was done and what was left",
	sections: SECTIONS,
	settings: GOAL_SETTINGS,
	setup(scope) {
		let session: ExtensionContext | undefined;
		let state = emptyGoal();
		let settling: Promise<void> | undefined;
		// The last entry the agent's work was read up to, so the same work is not read twice.
		let readUpTo: string | undefined;
		// The tidy pass reads everything since it last ran, and runs only after something changed.
		let tidiedUpTo: string | undefined;
		let untidy = false;
		let stop = new AbortController();
		// One update at a time, each on the state the one before left.
		const turns = oneAtATime();
		const pace: Pace = { working: false, lastWork: 0 };

		function show(): void {
			const current = nowOf(state);
			const words = (pace.working ? current?.activeForm : undefined) ?? current?.text ?? state.goal;
			session?.ui.setStatus(GOAL_STATUS, words === undefined ? undefined : `\u25b8 ${words}`);
			scope.events.emit(GOAL_CHANGED, state);
		}

		const keeper: GoalKeeper = {
			state: () => state,
			apply(ops, trigger, extra = {}) {
				const source: GoalSource = trigger === "work" || trigger === "tidy" ? "work" : "you";
				const next = applyGoalOps(state, ops, { at: Date.now(), source, entry: extra.entry });
				if (sameItems(next, state)) return false;
				state = next;
				const { proposal, covers } = extra;
				const update: GoalUpdate = {
					version: GOAL_VERSION,
					trigger,
					ops: [...ops],
					...(covers === undefined ? {} : { covers }),
					...(proposal === undefined ? {} : { model: proposal.model, usage: proposal.usage }),
					state,
				};
				scope.appendEntry(GOAL_ENTRY, update);
				if (trigger !== "tidy") untidy = true;
				show();
				return true;
			},
		};

		function models(ctx: ExtensionContext) {
			return modelsFor(model.get(scope), ctx.modelRegistry, ctx.model);
		}

		function fromMessage(ctx: ExtensionContext, text: string): Promise<void> {
			const signal = stop.signal;
			return turns(async () => {
				const request = { state, trigger: "message" as const, news: text };
				const proposal = await propose(ctx.modelRegistry, models(ctx), request, signal);
				if (proposal === undefined || signal.aborted) return;
				// By now pi has written the message, so the change points at it.
				const entry = lastMessage(ctx.sessionManager.getBranch())?.entry;
				keeper.apply(proposal.ops, "message", {
					proposal,
					entry,
					covers: { from: entry, to: entry },
				});
			}, signal).catch(() => undefined);
		}

		function fromWork(ctx: ExtensionContext): Promise<void> {
			clearTimeout(pace.workTimer);
			pace.workTimer = undefined;
			const signal = stop.signal;
			return turns(async () => {
				const branch = ctx.sessionManager.getBranch();
				const work = workSince(branch, readUpTo);
				if (work.text === "") return;
				readUpTo = work.to;
				pace.lastWork = Date.now();
				const asked = lastMessage(branch)?.text;
				const request = { state, trigger: "work" as const, news: work.text, asked };
				const proposal = await propose(ctx.modelRegistry, models(ctx), request, signal);
				if (proposal === undefined || signal.aborted) return;
				const covers = { from: work.from, to: work.to };
				keeper.apply(proposal.ops, "work", { proposal, entry: work.to, covers });
			}, signal).catch(() => undefined);
		}

		/** After a run: one look at the whole timeline, to merge repeats and close what was finished. */
		function tidyUp(ctx: ExtensionContext): Promise<void> {
			const signal = stop.signal;
			return turns(async () => {
				if (!untidy) return;
				untidy = false;
				const work = workSince(ctx.sessionManager.getBranch(), tidiedUpTo);
				const request = { state, work: work.text };
				const proposal = await tidy(ctx.modelRegistry, models(ctx), request, signal);
				if (proposal === undefined || signal.aborted) return;
				tidiedUpTo = work.to ?? tidiedUpTo;
				keeper.apply(proposal.ops, "tidy", { proposal, entry: work.to, covers: work });
			}, signal).catch(() => undefined);
		}

		/** During a long turn: at most one update per interval, and only with work to read. */
		function workLater(ctx: ExtensionContext): void {
			const every = interval.get(scope) * 1000;
			if (every === 0 || pace.workTimer !== undefined) return;
			const wait = Math.max(0, pace.lastWork + every - Date.now());
			pace.workTimer = setTimeout(() => void fromWork(ctx), wait);
		}

		function stopWorking(): void {
			pace.working = false;
			clearTimeout(pace.workTimer);
			pace.workTimer = undefined;
		}

		function restore(ctx: ExtensionContext): void {
			state = goalFromEntries(ctx.sessionManager.getBranch());
			readUpTo = undefined;
			tidiedUpTo = undefined;
			// A timeline that comes back from a file gets one tidy pass after the next run.
			untidy = state.items.length > 0;
			show();
		}

		scope.onSessionStart((ctx) => {
			session = ctx;
			stop = new AbortController();
			restore(ctx);
		});
		scope.on("session_tree", (_event, ctx) => restore(ctx));
		scope.onShutdown(() => {
			stop.abort();
			stopWorking();
			session = undefined;
		});

		scope.events.on(GOAL_STATE, (data: unknown) =>
			answerGoal(data, state, { settling, working: pace.working }),
		);

		// With nobody at the keyboard, as in a print run, it is not worth a model call per message.
		scope.on("input", (event, ctx) => {
			const text = event.text.trim();
			if (!ctx.hasUI || text === "") return undefined;
			settling = fromMessage(ctx, text);
			return undefined;
		});

		scope.on("agent_start", (_event, ctx) => {
			if (!ctx.hasUI) return;
			pace.working = true;
			pace.lastWork = Date.now();
			show();
		});

		scope.on("turn_end", (_event, ctx) => {
			if (ctx.hasUI && pace.working) workLater(ctx);
		});

		scope.on("agent_settled", (_event, ctx) => {
			if (!ctx.hasUI) return;
			stopWorking();
			show();
			void fromWork(ctx).then(() => tidyUp(ctx));
		});

		registerScreen(scope, keeper);
	},
});

function sameItems(left: SessionGoal, right: SessionGoal): boolean {
	return (
		left.goal === right.goal &&
		left.language === right.language &&
		JSON.stringify(left.items) === JSON.stringify(right.items)
	);
}

export default function piGoal(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-goal" }).use(goal).build();
}

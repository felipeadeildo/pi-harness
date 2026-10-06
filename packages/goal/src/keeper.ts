// The live timeline, and the entries that record its changes and what each call cost.
import {
	applyGoalOps,
	emptyGoal,
	GOAL_ENTRY,
	GOAL_USAGE_ENTRY,
	GOAL_VERSION,
	type GoalCall,
	type GoalOp,
	type GoalTrigger,
	type GoalUpdate,
	goalFromEntries,
	type SessionGoal,
} from "@adeildo/pi-kit";

import type { Proposal } from "./ask.ts";

export interface ChangeContext {
	entry?: string;
	covers?: GoalUpdate["covers"];
	proposal?: Proposal;
}

type Append = (customType: string, data: unknown) => void;

export class Keeper {
	#state: SessionGoal = emptyGoal();
	readonly #append: Append;
	readonly #changed: (trigger: GoalTrigger) => void;

	constructor(append: Append, changed: (trigger: GoalTrigger) => void) {
		this.#append = append;
		this.#changed = changed;
	}

	state(): SessionGoal {
		return this.#state;
	}

	restore(branch: readonly unknown[]): void {
		this.#state = goalFromEntries(branch);
	}

	/** False when the operations changed nothing, and then nothing is written. */
	apply(ops: readonly GoalOp[], trigger: GoalTrigger, context: ChangeContext = {}): boolean {
		const source = trigger === "work" || trigger === "tidy" ? "work" : "you";
		const next = applyGoalOps(this.#state, ops, { at: Date.now(), source, entry: context.entry });
		if (sameTimeline(next, this.#state)) return false;
		this.#state = next;
		const { proposal, covers } = context;
		const update: GoalUpdate = {
			version: GOAL_VERSION,
			trigger,
			ops: [...ops],
			...(covers === undefined ? {} : { covers }),
			...(proposal === undefined ? {} : { model: proposal.model, usage: proposal.usage }),
			state: next,
		};
		this.#append(GOAL_ENTRY, update);
		this.#changed(trigger);
		return true;
	}

	/** Applies what a model proposed, or keeps only its cost when it changed nothing. */
	settle(proposal: Proposal, trigger: GoalTrigger, context: Omit<ChangeContext, "proposal">): void {
		if (this.apply(proposal.ops, trigger, { ...context, proposal })) return;
		const call: GoalCall = { trigger, model: proposal.model, usage: proposal.usage };
		this.#append(GOAL_USAGE_ENTRY, call);
	}
}

function sameTimeline(left: SessionGoal, right: SessionGoal): boolean {
	return (
		left.goal === right.goal &&
		left.language === right.language &&
		JSON.stringify(left.items) === JSON.stringify(right.items)
	);
}

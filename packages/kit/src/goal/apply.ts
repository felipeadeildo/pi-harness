import {
	type GoalItem,
	type GoalMark,
	type GoalOp,
	type GoalSource,
	type ItemStatus,
	nowOf,
	type SessionGoal,
} from "./timeline.ts";

/** Operations that do not fit, like `done` with nothing under way, are skipped. */
export function applyGoalOps(
	state: SessionGoal,
	ops: readonly GoalOp[],
	options: { at: number; source: GoalSource; entry?: string },
): SessionGoal {
	const draft = new Draft(state, options);
	for (const op of ops) draft.apply(op);
	return draft.done();
}

class Draft {
	readonly #next: SessionGoal;
	readonly #at: number;
	readonly #source: GoalSource;
	readonly #mark: GoalMark;

	constructor(state: SessionGoal, options: { at: number; source: GoalSource; entry?: string }) {
		this.#next = { ...state, items: state.items.map((item) => ({ ...item })) };
		this.#at = options.at;
		this.#source = options.source;
		this.#mark =
			options.entry === undefined ? { at: options.at } : { at: options.at, entry: options.entry };
	}

	apply(op: GoalOp): void {
		switch (op.op) {
			case "goal":
				return this.#setGoal(op.text.trim());
			case "language":
				if (this.#source === "you" && op.text.trim() !== "") this.#next.language = op.text.trim();
				return;
			case "start":
				return this.#start(op.text.trim(), op.active);
			case "resume": {
				const item = this.#find(op.id);
				if (item === undefined || item.status === "now") return;
				this.#pauseCurrent(item);
				this.#move(item, "now");
				return;
			}
			case "pause": {
				const current = nowOf(this.#next);
				if (current === undefined) return;
				this.#move(current, "later", op.note);
				return;
			}
			case "done": {
				const item = op.id === undefined ? nowOf(this.#next) : this.#find(op.id);
				if (item === undefined || item.status === "done") return;
				this.#move(item, "done", op.note);
				return;
			}
			case "later": {
				const text = op.text.trim();
				if (text !== "" && this.#listed(text) === undefined)
					this.#add(text, "later", { activeForm: op.active?.trim(), note: op.note });
				return;
			}
			case "drop": {
				const item = this.#find(op.id);
				if (item === undefined || item.status === "dropped" || item.status === "done") return;
				this.#move(item, "dropped", op.note);
				return;
			}
			case "rename": {
				const item = this.#find(op.id);
				if (item === undefined || op.text.trim() === "") return;
				item.text = op.text.trim();
				const active = op.active?.trim();
				if (active) item.activeForm = active;
				item.updatedAt = this.#at;
				return;
			}
		}
	}

	done(): SessionGoal {
		this.#next.updatedAt = this.#at;
		return this.#next;
	}

	#setGoal(text: string): void {
		if (text === "" || (this.#source === "work" && this.#next.goalSource === "you")) return;
		this.#next.goal = text;
		this.#next.goalSource = this.#source;
	}

	#start(text: string, active: string | undefined): void {
		if (text === "") return;
		const listed = this.#listed(text);
		if (listed?.status === "now") return;
		this.#pauseCurrent(listed);
		if (listed === undefined) this.#add(text, "now", { activeForm: active?.trim() });
		else this.#move(listed, "now");
	}

	#find(id: string): GoalItem | undefined {
		return this.#next.items.find((item) => item.id === id);
	}

	/** An open or finished item with the same words, which a new one would repeat. */
	#listed(text: string): GoalItem | undefined {
		return this.#next.items.find((item) => item.status !== "dropped" && sameWords(item.text, text));
	}

	#move(item: GoalItem, status: ItemStatus, note?: string): void {
		item.status = status;
		item.updatedAt = this.#at;
		if (status === "now") item.started = this.#mark;
		if (status === "done" || status === "dropped") item.finished = this.#mark;
		if (note !== undefined) item.note = note;
	}

	#pauseCurrent(except?: GoalItem): void {
		const current = nowOf(this.#next);
		if (current !== undefined && current !== except) this.#move(current, "later");
	}

	#add(text: string, status: ItemStatus, extra: Pick<GoalItem, "activeForm" | "note">): void {
		const item: GoalItem = {
			id: `g${this.#next.nextId++}`,
			text,
			status,
			source: this.#source,
			createdAt: this.#at,
			updatedAt: this.#at,
		};
		if (extra.activeForm) item.activeForm = extra.activeForm;
		if (extra.note) item.note = extra.note;
		if (status === "now") item.started = this.#mark;
		this.#next.items.push(item);
	}
}

function sameWords(left: string, right: string): boolean {
	return wordsOf(left) === wordsOf(right);
}

function wordsOf(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

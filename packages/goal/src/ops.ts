// The model's operations: which ones each moment may send, read defensively, and checked against
// the session, so a step only closes on words that are really there.
import { type GoalOp, isObject, type SessionGoal } from "@adeildo/pi-kit";
import { type TSchema, Type } from "@earendil-works/pi-ai";

import { CALL } from "./transcript.ts";

const MAX_TEXT = 240;
/** A proof shorter than this matches too much to prove anything. */
const MIN_PROOF = 8;

/** Your message opens and closes steps, the agent's work only closes or puts off, the tidy pass cleans. */
export type Moment = "message" | "work" | "tidy";

type OpName = GoalOp["op"];

export const OPS_FOR: Record<Moment, readonly OpName[]> = {
	message: ["goal", "language", "start", "resume", "pause", "later", "done", "drop", "rename"],
	work: ["done", "later"],
	tidy: ["goal", "done", "drop", "rename"],
};

function text(description: string): TSchema {
	return Type.String({ description });
}

const ID = text("An item's id, like g3.");
const ACTIVE = text("The same item as it runs, like 'Showing the goal on the top strip'.");
const PROOF = text(
	"Words copied exactly from the input that show it, at least a few words. Never a paraphrase.",
);

const SHAPES: Record<OpName, (moment: Moment) => TSchema> = {
	goal: () => shape("goal", { text: text("What the session is after, above the step.") }),
	language: () => shape("language", { text: text("Its English name, like 'Portuguese'.") }),
	start: () => shape("start", { text: text("A new step, imperative."), active: ACTIVE }),
	resume: () => shape("resume", { id: ID }),
	pause: () => shape("pause", {}, { missing: text("What the step still needs.") }),
	later: () =>
		shape(
			"later",
			{ text: text("What was put off, imperative."), active: ACTIVE },
			{ why: text("Why it waits.") },
		),
	done: (moment) =>
		moment === "tidy"
			? shape(
					"done",
					{ id: ID },
					{ proof: PROOF, same_as: text("The done item this one repeats.") },
				)
			: shape("done", { id: ID, proof: PROOF }, { missing: text("What the step left out.") }),
	drop: (moment) =>
		moment === "tidy"
			? shape("drop", { id: ID, same_as: text("The open item this one repeats.") })
			: shape("drop", { id: ID, proof: PROOF }),
	rename: () => shape("rename", { id: ID, text: text("The new words.") }, { active: ACTIVE }),
};

function shape(
	op: OpName,
	required: Record<string, TSchema>,
	extra: Record<string, TSchema> = {},
): TSchema {
	const fields = Object.fromEntries(
		Object.entries(extra).map(([name, schema]) => [name, Type.Optional(schema)]),
	);
	return Type.Object({ op: Type.Literal(op), ...required, ...fields });
}

/** The parameters of the tool for one moment: only its operations, each with its own fields. */
export function opsSchema(moment: Moment): TSchema {
	const shapes = OPS_FOR[moment].map((op) => SHAPES[op](moment));
	return Type.Object({ ops: Type.Array(Type.Union(shapes)) });
}

/** Well formed operations this moment may send, in the timeline's terms. */
export function opsOf(raw: unknown, moment: Moment = "message"): GoalOp[] {
	if (!Array.isArray(raw)) return [];
	const allowed = new Set(OPS_FOR[moment]);
	return raw.flatMap((entry): GoalOp[] => {
		const op = entryOf(entry);
		return op !== undefined && allowed.has(op.op) ? [op] : [];
	});
}

function entryOf(raw: unknown): GoalOp | undefined {
	if (!isObject(raw)) return undefined;
	const words = clean(raw.text);
	const id = typeof raw.id === "string" ? raw.id.trim() : undefined;
	const sameAs = typeof raw.same_as === "string" ? raw.same_as.trim() : undefined;
	const active = field("active", clean(raw.active));
	const proven = field("proof", clean(raw.proof));
	switch (raw.op) {
		case "goal":
		case "language":
			return words ? { op: raw.op, text: words } : undefined;
		case "start":
			return words ? { op: "start", text: words, ...active } : undefined;
		case "later":
			return words
				? { op: "later", text: words, ...active, ...field("note", clean(raw.why)) }
				: undefined;
		case "rename":
			return id && words ? { op: "rename", id, text: words, ...active } : undefined;
		case "resume":
			return id ? { op: "resume", id } : undefined;
		case "pause":
			return { op: "pause", ...field("note", clean(raw.missing)) };
		case "done": {
			if (!id) return undefined;
			const left = sameAs ? `same as ${sameAs}` : clean(raw.missing);
			return { op: "done", id, ...field("note", left), ...proven };
		}
		case "drop": {
			if (!id) return undefined;
			const why = sameAs ? `same as ${sameAs}` : clean(raw.why);
			return { op: "drop", id, ...field("note", why), ...proven };
		}
		default:
			return undefined;
	}
}

function field<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

export interface Checked {
	ops: GoalOp[];
	rejected: GoalOp[];
}

/**
 * A done or a drop stands only on proof found in what the model read, outside the calls, or, in
 * the tidy pass, on the item it repeats. Everything else passes as it came.
 */
export function checkOps(
	ops: readonly GoalOp[],
	moment: Moment,
	read: string,
	state: SessionGoal,
): Checked {
	const words = read.split("\n").filter((line) => !line.startsWith(CALL));
	const haystack = normalized(words.join("\n"));
	const checked: Checked = { ops: [], rejected: [] };
	for (const op of ops) {
		const ok = op.op === "done" || op.op === "drop" ? closes(op, moment, haystack, state) : true;
		if (ok) checked.ops.push(repeatOfDone(op, state) ?? op);
		else checked.rejected.push(op);
	}
	return checked;
}

/** A drop of something already done is that work finished, not abandoned. */
function repeatOfDone(op: GoalOp, state: SessionGoal): GoalOp | undefined {
	if (op.op !== "drop") return undefined;
	const original = state.items.find((item) => item.id === repeatedId(op));
	return original?.status === "done" ? { op: "done", id: op.id, note: op.note } : undefined;
}

/** The item a `same as gN` note points to. */
function repeatedId(op: Extract<GoalOp, { op: "done" | "drop" }>): string | undefined {
	return /^same as (g\d+)$/.exec(op.note ?? "")?.[1];
}

function closes(
	op: Extract<GoalOp, { op: "done" | "drop" }>,
	moment: Moment,
	haystack: string,
	state: SessionGoal,
): boolean {
	const repeated = repeatedId(op);
	if (moment === "tidy" && repeated !== undefined) {
		const original = state.items.find((item) => item.id === repeated);
		return original !== undefined && original.id !== op.id && original.status !== "dropped";
	}
	return op.proof !== undefined && found(op.proof, haystack);
}

function found(proof: string, haystack: string): boolean {
	const needle = normalized(proof.replace(/^(said|call|operator):\s*/i, "")).replace(/…$/, "");
	return needle.length >= MIN_PROOF && haystack.includes(needle);
}

/** Case, quotes, markdown marks and spacing do not count. */
function normalized(value: string): string {
	return value
		.toLowerCase()
		.replace(/[*_`"'“”‘’]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function clean(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	const words = value.trim().replace(/\s+/g, " ");
	if (words.length <= MAX_TEXT) return words;
	// Cut at a word, and say it was cut.
	const cut = words.slice(0, MAX_TEXT);
	const space = cut.lastIndexOf(" ");
	return `${(space > MAX_TEXT / 2 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}\u2026`;
}

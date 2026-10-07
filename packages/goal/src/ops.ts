// What the model may send at each moment, read defensively and checked against the session.
import { type GoalOp, isObject, nowOf, type SessionGoal } from "@adeildo/pi-kit";
import { type TSchema, Type } from "@earendil-works/pi-ai";

import { CALL, FAILED, type Line } from "./transcript.ts";

const MAX_TEXT = 240;
const NOT_DONE = "only an idea, not done";
const MIN_PROOF = 8;

export type Moment = "message" | "working" | "work" | "tidy";

/** `not_done` becomes reopen or drop. */
type OpName = Exclude<GoalOp["op"], "reopen"> | "not_done";

export const OPS_FOR: Record<Moment, readonly OpName[]> = {
	message: [
		"goal",
		"language",
		"start",
		"resume",
		"pause",
		"later",
		"done",
		"drop",
		"not_done",
		"rename",
	],
	working: ["later"],
	// The step closes through the required `step` verdict.
	work: ["later"],
	tidy: ["goal", "done", "drop", "rename"],
};

function text(description: string): TSchema {
	return Type.String({ description });
}

const ID = text("An item's id, like g3.");
const ACTIVE = text("The same item as it runs, like 'Showing the goal on the top strip'.");
const MISSING = text('What the step left out or left for after, or "" when nothing.');
const PROOF = text(
	"Words copied exactly from the input that show it, at least a few words. Never a paraphrase.",
);

const SHAPES: Record<OpName, (moment: Moment) => TSchema> = {
	goal: () => shape("goal", { text: text("What the session is after, above the step.") }),
	language: () => shape("language", { text: text("Its English name, like 'Portuguese'.") }),
	start: () =>
		shape("start", {
			text: text("A new step, imperative. The step under way moves to later by itself."),
			active: ACTIVE,
		}),
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
			: shape("done", { id: ID, proof: PROOF }, { missing: MISSING }),
	drop: (moment) =>
		moment === "tidy"
			? shape("drop", { id: ID, same_as: text("The open item this one repeats.") })
			: shape("drop", { id: ID, proof: PROOF }),
	not_done: () =>
		shape("not_done", {
			id: ID,
			proof: PROOF,
			still_wanted: Type.Boolean({
				description: "False only when the operator also says they will not do it.",
			}),
		}),
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

/** Evidence first, so the model reads before it decides. */
const STEP = Type.Object({
	proof: text(
		'Words copied exactly from one "said:" line that report the step under way done, or "" when no line does.',
	),
	missing: MISSING,
	finished: Type.Boolean({
		description: "The work of the step under way finished, even with something left.",
	}),
});

export function opsSchema(moment: Moment): TSchema {
	const shapes = OPS_FOR[moment].map((op) => SHAPES[op](moment));
	const ops = Type.Array(Type.Union(shapes));
	return moment === "work" ? Type.Object({ step: STEP, ops }) : Type.Object({ ops });
}

export function stepOf(raw: unknown, state: SessionGoal): GoalOp[] {
	const current = nowOf(state);
	if (current === undefined || !isObject(raw) || raw.finished !== true) return [];
	return [
		{
			op: "done",
			id: current.id,
			...field("proof", clean(raw.proof)),
			...field("note", given(raw.missing)),
		},
	];
}

export function opsOf(raw: unknown, moment: Moment = "message"): GoalOp[] {
	if (!Array.isArray(raw)) return [];
	const allowed = new Set<unknown>(OPS_FOR[moment]);
	return raw.flatMap((entry): GoalOp[] => {
		const op = isObject(entry) && allowed.has(entry.op) ? entryOf(entry) : undefined;
		return op === undefined ? [] : [op];
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
			const left = sameAs ? `same as ${sameAs}` : given(raw.missing);
			return { op: "done", id, ...field("note", left), ...proven };
		}
		case "not_done": {
			if (!id) return undefined;
			if (raw.still_wanted === false) return { op: "drop", id, note: NOT_DONE, ...proven };
			return { op: "reopen", id, ...proven };
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

export function checkOps(
	ops: readonly GoalOp[],
	moment: Moment,
	read: readonly Line[],
	state: SessionGoal,
): Checked {
	const haystack = read.map((line) => ({
		at: line.at,
		text: normalized(line.text),
		call: line.text.startsWith(CALL),
		failed: line.text.endsWith(FAILED),
	}));
	const checked: Checked = { ops: [], rejected: [] };
	let opened = false;
	for (const proposed of ops) {
		const op = moment === "tidy" ? repeatOfOpen(proposed, state) : proposed;
		if (restatesStep(op, state)) {
			// Only your message may put the step off.
			if (moment === "message") checked.ops.push({ op: "pause", ...field("note", op.note) });
			else checked.rejected.push(op);
			continue;
		}
		if (op.op === "start" || op.op === "resume") {
			if (opened) {
				// One step per message; the other asks wait in later.
				if (op.op === "start") checked.ops.push({ op: "later", text: op.text, ...activeOf(op) });
				else checked.rejected.push(op);
				continue;
			}
			opened = true;
		}
		const ok = needsProof(op) ? closes(op, moment, haystack, state) : true;
		if (ok) checked.ops.push(repeatOfDone(op, state) ?? op);
		else checked.rejected.push(op);
	}
	return checked;
}

function activeOf(op: Extract<GoalOp, { op: "start" }>): { active?: string } {
	return op.active === undefined ? {} : { active: op.active };
}

function restatesStep(op: GoalOp, state: SessionGoal): op is Extract<GoalOp, { op: "later" }> {
	const current = nowOf(state);
	return op.op === "later" && current !== undefined && sameWords(op.text, current.text);
}

/** Done work never closes as a repeat; the open item does. */
function repeatOfOpen(op: GoalOp, state: SessionGoal): GoalOp {
	if (op.op !== "drop" && op.op !== "done") return op;
	const repeated = repeatedId(op);
	const item = state.items.find((entry) => entry.id === op.id);
	const original = state.items.find((entry) => entry.id === repeated);
	if (item?.status !== "done" || original === undefined) return op;
	if (original.status === "done" || original.status === "dropped") return op;
	return { op: "done", id: original.id, note: `same as ${item.id}` };
}

function repeatOfDone(op: GoalOp, state: SessionGoal): GoalOp | undefined {
	if (op.op !== "drop") return undefined;
	const original = state.items.find((item) => item.id === repeatedId(op));
	return original?.status === "done" ? { op: "done", id: op.id, note: op.note } : undefined;
}

type Proven = Extract<GoalOp, { op: "done" | "drop" | "reopen" }>;

function needsProof(op: GoalOp): op is Proven {
	return op.op === "done" || op.op === "drop" || op.op === "reopen";
}

function repeatedId(op: Proven): string | undefined {
	if (op.op === "reopen") return undefined;
	return /^same as (g\d+)$/.exec(op.note ?? "")?.[1];
}

interface Read {
	at?: number;
	text: string;
	call: boolean;
	failed: boolean;
}

function closes(
	op: Proven,
	moment: Moment,
	haystack: readonly Read[],
	state: SessionGoal,
): boolean {
	const repeated = repeatedId(op);
	if (moment === "tidy" && repeated !== undefined) {
		const original = state.items.find((item) => item.id === repeated);
		return original !== undefined && original.id !== op.id && original.status !== "dropped";
	}
	const item = state.items.find((entry) => entry.id === op.id);
	// Done work leaves only through not_done.
	if (op.op === "drop" && item?.status === "done" && op.note !== NOT_DONE) return false;
	// The tidy pass reads agreeing to wait as finishing, so it never closes what waits.
	if (op.proof === undefined || (moment === "tidy" && item?.status === "later")) return false;
	// Words older than the item, like the ask that put it off, prove nothing.
	const at = found(op.proof, haystack, item?.createdAt ?? 0);
	if (at === -1) return false;
	// Your line has to name the item: "it showed up" could be about anything.
	const said = haystack[at]?.text ?? "";
	if (moment === "message" && item !== undefined && !sharesWord(said, item.text)) return false;
	// After a call that failed, "done" is a claim.
	return !(moment === "work" && haystack.slice(0, at).findLast((line) => line.call)?.failed);
}

function found(proof: string, haystack: readonly Read[], since: number): number {
	const needle = normalized(proof.replace(/^(said|call|operator):\s*/i, "")).replace(/…$/, "");
	if (needle.length < MIN_PROOF) return -1;
	return haystack.findIndex(
		(line) =>
			!line.call && (line.at === undefined || line.at >= since) && line.text.includes(needle),
	);
}

/** Two words with the same first letters are one: "publiquei" names "Publicar". */
const STEM = 5;
/** Words any message has, which name no step. */
const COMMON_WORDS =
	"agora aqui esse essa isso esta está para pode feito fazer tudo with that this done already just have";
const COMMON = new Set(COMMON_WORDS.split(" "));

function stems(words: string): Set<string> {
	return new Set(
		normalized(words)
			.split(/[^\p{L}\p{N}]+/u)
			.filter((word) => word.length >= 4 && !COMMON.has(word))
			.map((word) => word.slice(0, STEM)),
	);
}

function sharesWord(left: string, right: string): boolean {
	const named = stems(right);
	return [...stems(left)].some((stem) => named.has(stem));
}

function sameWords(left: string, right: string): boolean {
	const a = stems(left);
	const b = stems(right);
	const shared = [...a].filter((stem) => b.has(stem)).length;
	return shared > 0 && shared / Math.max(a.size, b.size) >= 0.75;
}

function normalized(value: string): string {
	return value
		.toLowerCase()
		.replace(/[*_`"'“”‘’]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

const NOTHING = /^(-|n\/?a|none|nothing|nenhum|nenhuma|nada)\.?$/i;

function given(value: unknown): string | undefined {
	const words = clean(value);
	return words === undefined || NOTHING.test(words) ? undefined : words;
}

function clean(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	const words = value.trim().replace(/\s+/g, " ");
	if (words.length <= MAX_TEXT) return words;
	const cut = words.slice(0, MAX_TEXT);
	const space = cut.lastIndexOf(" ");
	return `${(space > MAX_TEXT / 2 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}\u2026`;
}

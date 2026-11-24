// A bash chain split into the commands it runs, each with the folders it can run in, so each one is
// decided on its own. Anything it cannot follow returns undefined, and the whole line is decided
// as one call.
import { homedir } from "node:os";

import { commandWords } from "#core/readonly-bash.ts";
import { tokenize } from "#core/tools.ts";
import { resolvePath } from "#core/workspace.ts";

export interface ChainStep {
	command: string;
	/** Every folder the step can run in. `undefined` is a folder nothing here can tell. */
	cwds: (string | undefined)[];
	/** `cd` or `exit`: it runs nothing, and the steps after it are decided in the folder it leaves. */
	control: boolean;
}

type Operator = "&&" | "||" | "|" | ";" | "&";

interface Pipeline {
	/** The operator before it in its list, `undefined` for the first. */
	joint?: "&&" | "||";
	steps: string[];
}

interface List {
	pipelines: Pipeline[];
	/** Ended by `&`: it runs in a subshell, so a `cd` in it moves nothing after. */
	background: boolean;
}

const MAX_STEPS = 64;

// Grammar this splitter does not model, or a builtin that changes what later commands resolve to
// in a way the folder tracking cannot follow. Any of them sends the whole line to the old path.
const UNFOLLOWED_HEADS = new Set([
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"case",
	"esac",
	"for",
	"select",
	"while",
	"until",
	"do",
	"done",
	"function",
	"time",
	"coproc",
	"{",
	"}",
	"[[",
	"]]",
	"eval",
	"source",
	".",
	"exec",
	"command",
	"builtin",
	"alias",
	"unalias",
	"set",
	"shopt",
	"enable",
	"export",
	"unset",
	"declare",
	"typeset",
	"local",
	"readonly",
	"hash",
	"trap",
]);
const FOLDER_CHANGERS = new Set(["pushd", "popd"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const CD_FLAG = /^-[LPe@]+$/;
const UNREADABLE_TARGET = /[$*?[\]{}`]/;

/** Undefined when the command is a single step, or when it holds grammar the split cannot follow. */
export function chainSteps(
	command: string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): ChainStep[] | undefined {
	const lists = splitLists(command);
	if (lists === undefined) return undefined;

	const count = lists.reduce(
		(sum, list) => sum + list.pipelines.reduce((n, pipeline) => n + pipeline.steps.length, 0),
		0,
	);
	if (count < 2 || count > MAX_STEPS) return undefined;

	const steps: ChainStep[] = [];
	let states: FolderState[] = [{ dir: cwd, ok: true }];
	for (const list of lists) {
		const entry = states;
		let current = states;
		for (const pipeline of list.pipelines) {
			const runs = current.filter((state) => runsAfter(pipeline.joint, state));
			const skips = current.filter((state) => !runsAfter(pipeline.joint, state));
			const dirs = unique(runs.map((state) => state.dir));
			const effects: Effect[] = [];
			for (const text of pipeline.steps) {
				const effect = effectOf(text, env);
				if (effect === undefined) return undefined;
				effects.push(effect);
				steps.push({
					command: text,
					cwds: dirs,
					control: effect.kind === "cd" || effect.kind === "exit",
				});
			}
			// Each command of a pipeline runs in a subshell, so only one standing alone moves the shell.
			const alone = pipeline.steps.length === 1 ? effects[0] : undefined;
			current = dedupe([...skips, ...runs.flatMap((state) => after(state.dir, alone, env))]);
		}
		states = list.background ? entry.map((state) => ({ dir: state.dir, ok: true })) : current;
	}
	return steps;
}

interface FolderState {
	dir: string | undefined;
	/** Whether the last pipeline succeeded, which decides what `&&` and `||` run next. */
	ok: boolean;
}

type Effect = (
	| { kind: "none" }
	| { kind: "exit" }
	/** No target goes home; `unreadable` is a target nothing here can read, like `$D`. */
	| { kind: "cd"; target?: string; unreadable?: true }
	| { kind: "unknown" }
) & {
	/** `! cmd`: the status is the other way round. */
	negated?: true;
};

function runsAfter(joint: Pipeline["joint"], state: FolderState): boolean {
	if (joint === "&&") return state.ok;
	if (joint === "||") return !state.ok;
	return true;
}

// Every command may fail, so each one leaves both outcomes behind it.
function after(
	dir: string | undefined,
	effect: Effect | undefined,
	env: NodeJS.ProcessEnv,
): FolderState[] {
	const failed = { dir, ok: false };
	let states: FolderState[] = [{ dir, ok: true }, failed];
	if (effect?.kind === "cd") states = [{ dir: cdTarget(dir, effect, env), ok: true }, failed];
	if (effect?.kind === "unknown")
		states = [
			{ dir: undefined, ok: true },
			{ dir: undefined, ok: false },
		];
	return effect?.negated ? states.map((state) => ({ ...state, ok: !state.ok })) : states;
}

function cdTarget(
	dir: string | undefined,
	{ target, unreadable }: { target?: string; unreadable?: true },
	env: NodeJS.ProcessEnv,
): string | undefined {
	if (unreadable) return undefined;
	if (target === undefined) return env.HOME ?? homedir();
	if (dir === undefined || target === "-" || UNREADABLE_TARGET.test(target)) return undefined;
	if (target.startsWith("~") && target !== "~" && !target.startsWith("~/")) return undefined;
	// With CDPATH set, `cd name` may land in any folder it lists.
	const relative = !target.startsWith("/") && !target.startsWith("~") && !target.startsWith(".");
	if (relative && env.CDPATH) return undefined;
	return resolvePath(target, dir);
}

function effectOf(text: string, env: NodeJS.ProcessEnv): Effect | undefined {
	const words = tokenize(text);
	let start = 0;
	while (words[start] === "!") start++;
	const negated = start % 2 === 1 ? { negated: true as const } : {};
	const effect = headEffect(text, words.slice(start), env);
	return effect && { ...effect, ...negated };
}

function headEffect(text: string, words: string[], env: NodeJS.ProcessEnv): Effect | undefined {
	let start = 0;
	while (ASSIGNMENT.test(words[start] ?? "")) start++;
	const head = words[start];
	// `D=/x; cat $D/a` is followed by the classifier that reads the whole line.
	if (head === undefined) return undefined;
	if (UNFOLLOWED_HEADS.has(head) || words.includes("[[")) return undefined;
	// `[` is the test command; anywhere else it is a glob, which hides the name like `$X` does.
	if (/[$`*?\]]/.test(head) || (head !== "[" && head.includes("["))) return { kind: "unknown" };
	if (FOLDER_CHANGERS.has(head)) return { kind: "unknown" };
	if (head === "exit") return { kind: "exit" };
	if (head !== "cd") return { kind: "none" };

	const literal = commandWords(text, env);
	if (literal === undefined) return { kind: "cd", unreadable: true };
	const cd = literal.indexOf("cd");
	const args = literal.slice(cd + 1);
	let index = 0;
	while (CD_FLAG.test(args[index] ?? "")) index++;
	if (args[index] === "--") index++;
	const targets = args.slice(index);
	if (targets.length > 1) return { kind: "cd", unreadable: true };
	return { kind: "cd", target: targets[0] };
}

/** Splits at the operators bash reads outside quotes. Undefined for grammar it does not model. */
function splitLists(command: string): List[] | undefined {
	const parts: (string | Operator)[] = [];
	let current = "";
	let single = false;
	let double = false;

	const push = (op: Operator) => {
		parts.push(current.trim(), op);
		current = "";
	};

	for (let index = 0; index < command.length; index++) {
		const char = command[index] ?? "";
		const next = command[index + 1];

		if (char === "\r") return undefined;
		if (single) {
			current += char;
			if (char === "'") single = false;
			continue;
		}
		if (char === "\\") {
			if (next === "\n") {
				current += " ";
			} else {
				current += char + (next ?? "");
			}
			index++;
			continue;
		}
		if (char === "`" || (char === "$" && next === "(")) return undefined;
		if (double) {
			current += char;
			if (char === '"') double = false;
			continue;
		}
		if (char === "'") single = true;
		if (char === '"') double = true;
		if (char === "(" || char === ")") return undefined;
		if (char === "<" && next === "<") return undefined;
		if (char === ";" && next === ";") return undefined;

		if (char === "#" && /(^|[\s;&|])$/.test(current)) {
			while (index + 1 < command.length && command[index + 1] !== "\n") index++;
			continue;
		}

		const last = current.at(-1);
		if (char === "&") {
			if (next === "&") {
				push("&&");
				index++;
				continue;
			}
			if (next === ">" || last === ">" || last === "<") {
				current += char;
				continue;
			}
			push("&");
			continue;
		}
		if (char === "|") {
			if (last === ">") {
				current += char;
				continue;
			}
			if (next === "|") {
				push("||");
				index++;
				continue;
			}
			if (next === "&") index++;
			push("|");
			continue;
		}
		if (char === ";") {
			push(";");
			continue;
		}
		if (char === "\n") {
			// After `&&`, `||` or `|`, a newline only continues the line.
			const previous = parts.at(-1);
			const continues =
				current.trim() === "" && (previous === "&&" || previous === "||" || previous === "|");
			if (!continues) push(";");
			continue;
		}
		current += char;
	}
	if (single || double) return undefined;
	parts.push(current.trim());

	return assemble(parts);
}

function assemble(parts: (string | Operator)[]): List[] | undefined {
	const lists: List[] = [];
	let pipelines: Pipeline[] = [];
	let steps: string[] = [];
	let joint: Pipeline["joint"];

	for (let index = 0; index < parts.length; index += 2) {
		const text = parts[index] as string;
		const op = parts[index + 1] as Operator | undefined;

		if (text === "") {
			// `a && && b`, `a |` or `| b` is a syntax error; an empty list between `;` is nothing.
			if (op === "&&" || op === "||" || op === "|") return undefined;
			if (steps.length > 0 || joint !== undefined) return undefined;
			continue;
		}
		steps.push(text);
		if (op === "|") continue;

		pipelines.push({ joint, steps });
		steps = [];
		if (op === "&&" || op === "||") {
			joint = op;
			continue;
		}
		lists.push({ pipelines, background: op === "&" });
		pipelines = [];
		joint = undefined;
	}
	return lists;
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function dedupe(states: FolderState[]): FolderState[] {
	const seen = new Map<string, FolderState>();
	for (const state of states) seen.set(`${state.ok}\u0000${state.dir ?? "\u0000"}`, state);
	return [...seen.values()];
}

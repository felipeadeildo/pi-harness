// Runs the cases against a real model and says which ones the timeline got right.
// bun packages/goal/eval/run.ts [--runs 3] [--model anthropic/claude-haiku-4-5] [--case text] [--show]
// It signs in with an Anthropic account from the harness's accounts file, billed to its plan.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
	applyGoalOps,
	describeGoal,
	type GoalItem,
	type ItemStatus,
	nowOf,
	type SessionGoal,
} from "@adeildo/pi-kit";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { userAgent } from "../../providers/src/subscription/billing.ts";
import { billToPlan } from "../../providers/src/subscription/payload.ts";
import { propose, tidy } from "../src/ask.ts";
import { type Case, CASES, type Expect } from "./cases.ts";

const CLAUDE_CODE = "2.1.280";

const { values } = parseArgs({
	options: {
		runs: { type: "string", default: "3" },
		model: { type: "string", default: "anthropic/claude-haiku-4-5" },
		case: { type: "string" },
		show: { type: "boolean", default: false },
	},
});

const registry = await signedIn();
const [provider = "", ...rest] = values.model.split("/");
const chosen = registry.find(provider, rest.join("/"));
if (chosen === undefined) throw new Error(`no model ${values.model}`);

const runs = Number(values.runs);
const cases = CASES.filter((c) => values.case === undefined || c.name.includes(values.case));
let passed = 0;
let total = 0;
let cost = 0;
let refused = 0;

const results = await Promise.all(
	cases.map(async (c) => {
		const outcomes = await Promise.all(Array.from({ length: runs }, () => attempt(c, chosen)));
		return { c, outcomes };
	}),
);

for (const { c, outcomes } of results) {
	const ok = outcomes.filter((o) => o.problems.length === 0).length;
	passed += ok;
	total += outcomes.length;
	cost += outcomes.reduce((sum, o) => sum + o.cost, 0);
	refused += outcomes.reduce((sum, o) => sum + (o.rejected?.length ?? 0), 0);
	console.log(`${ok === outcomes.length ? "✓" : "✗"} ${ok}/${outcomes.length}  ${c.name}`);
	for (const o of outcomes) {
		if (o.problems.length === 0 && !values.show) continue;
		console.log(`    ${o.problems.join("; ") || "ok"}`);
		console.log(`      ops: ${JSON.stringify(o.ops)}`);
		if (o.rejected?.length) console.log(`      refused: ${JSON.stringify(o.rejected)}`);
		if (values.show) console.log(indent(describeGoal(o.after), "      | "));
	}
}
const share = Math.round((passed / total) * 100);
console.log(
	`\n${passed}/${total} (${share}%), ${refused} refused by the checks, $${cost.toFixed(3)}`,
);

interface Outcome {
	problems: string[];
	ops: unknown;
	rejected?: unknown[];
	after: SessionGoal;
	cost: number;
}

async function attempt(c: Case, target: Model<Api>): Promise<Outcome> {
	const signal = new AbortController().signal;
	const { request } = c;
	const proposal =
		request.trigger === "tidy"
			? await tidy(registry, [target], request, signal)
			: await propose(registry, [target], request, signal);
	if (proposal === undefined)
		return { problems: ["no answer"], ops: [], after: request.state, cost: 0 };
	const source = request.trigger === "message" ? "you" : "work";
	const after = applyGoalOps(request.state, proposal.ops, { at: 1, source });
	return {
		problems: check(request.state, after, c.expect),
		ops: proposal.ops,
		rejected: proposal.rejected,
		after,
		cost: proposal.usage.cost,
	};
}

function check(before: SessionGoal, after: SessionGoal, expect: Expect): string[] {
	const problems: string[] = [];
	const status = (id: string) => after.items.find((item) => item.id === id)?.status;
	const wanted: [ids: string[] | undefined, status: ItemStatus][] = [
		[expect.done, "done"],
		[expect.later, "later"],
		[expect.dropped, "dropped"],
	];
	for (const [ids = [], want] of wanted)
		for (const id of ids)
			if (status(id) !== want) problems.push(`${id} is ${status(id)}, not ${want}`);
	for (const id of expect.open ?? [])
		if (status(id) === "done" || status(id) === "dropped") problems.push(`${id} closed`);

	const now = nowOf(after);
	const nowProblem = expect.now === undefined ? undefined : checkNow(now, expect.now);
	if (nowProblem !== undefined) problems.push(nowProblem);
	const added = after.items.length - before.items.length;
	if (expect.noNew && added > 0)
		problems.push(`added ${after.items.slice(-added).map((item) => `"${item.text}"`)}`);

	if (expect.goalNot?.test(after.goal ?? "")) problems.push(`goal "${after.goal}"`);
	if (expect.goalAboveNow) {
		const goal = after.goal ?? "";
		if (goal === "" || (now !== undefined && sameish(goal, now.text)))
			problems.push(`goal "${goal}" over "${now?.text ?? ""}"`);
	}
	if (expect.mentions) {
		const said = after.items.flatMap((item) =>
			item.status === "dropped" ? [] : [item.status === "done" ? "" : item.text, item.note ?? ""],
		);
		if (!said.some((text) => expect.mentions?.test(text)))
			problems.push(`nothing says ${expect.mentions}`);
	}
	return problems;
}

function checkNow(now: GoalItem | undefined, want: NonNullable<Expect["now"]>): string | undefined {
	if (want instanceof RegExp)
		return now !== undefined && want.test(now.text) ? undefined : `now is "${now?.text ?? ""}"`;
	switch (want) {
		case "empty":
			return now === undefined ? undefined : `now is "${now.text}"`;
		case "set":
			return now === undefined ? "now is empty" : undefined;
		default:
			return now?.id === want ? undefined : `now is ${now?.id ?? "empty"}, not ${want}`;
	}
}

function words(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^\p{L}\p{N}.]+/u)
			.filter((word) => word.length > 2),
	);
}

/** The same words, give or take articles and order. */
function sameish(left: string, right: string): boolean {
	const a = words(left);
	const b = words(right);
	const shared = [...a].filter((word) => b.has(word)).length;
	return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.75;
}

function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => prefix + line)
		.join("\n");
}

/** Pi's models, with every Anthropic request signed by a harness account and billed to its plan. */
async function signedIn(): Promise<ModelRegistry> {
	const runtime = await ModelRuntime.create({ authPath: join(homedir(), ".pi/agent/auth.json") });
	const signed = new ModelRegistry(runtime);
	const token = accountToken();
	const stream = signed.streamSimple.bind(signed);
	signed.streamSimple = (target, context, options) =>
		stream(target, context, {
			...options,
			apiKey: token,
			headers: { ...options?.headers, "user-agent": userAgent(CLAUDE_CODE) },
			onPayload: (payload) =>
				typeof payload === "object" && payload !== null
					? billToPlan(payload as Record<string, unknown>, CLAUDE_CODE)
					: undefined,
		});
	return signed;
}

interface Account {
	credential: { access?: string; expires?: number };
	health?: { limitedUntil?: number };
}

function accountToken(): string {
	const file = join(homedir(), ".pi/agent/extensions/pi-harness/accounts.json");
	const accounts = (
		JSON.parse(readFileSync(file, "utf8")) as {
			providers: { anthropic?: { accounts: Account[] } };
		}
	).providers.anthropic?.accounts;
	const now = Date.now();
	const usable = accounts?.find(
		(account) =>
			(account.health?.limitedUntil ?? 0) * 1000 < now &&
			(account.credential.expires ?? 0) > now + 60_000 &&
			account.credential.access !== undefined,
	);
	if (usable?.credential.access === undefined)
		throw new Error("no Anthropic account with a live token; open pi once to refresh them");
	return usable.credential.access;
}

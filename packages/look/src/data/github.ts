// CI's last run on this branch and your open pull requests that wait on you, asked once per launch.
// Shows nothing without gh, network or a GitHub remote.
import { isObject } from "@adeildo/pi-kit";

import { processRunner, type Runner } from "./runner.ts";

const FAILED = new Set(["failure", "startup_failure", "timed_out"]);
/** Enough to tell a new comment from an old one. */
const PR_FIELDS = "number,title,author,reviewDecision,comments";

interface CiFailure {
	branch: string;
	sha: string;
	name: string;
}

interface OpenPullRequest {
	number: number;
	title: string;
	waits: "changes requested" | "new comment";
}

export interface GithubState {
	ci: CiFailure | undefined;
	pr: OpenPullRequest | undefined;
}

/** Never rejects. `since` is the last session here, the bar for a comment to be news. */
export async function readGithub(
	cwd: string,
	since: number | undefined,
	run: Runner = processRunner(cwd),
): Promise<GithubState> {
	const [branch, pr] = await Promise.all([branchOf(run), pullRequest(run, since)]);
	const ci = branch === undefined ? undefined : await failedRun(run, branch);
	return { ci, pr };
}

async function branchOf(run: Runner): Promise<string | undefined> {
	const branch = (await ask(() => run("git", ["branch", "--show-current"])))?.trim();
	return branch === undefined || branch === "" ? undefined : branch;
}

async function failedRun(run: Runner, branch: string): Promise<CiFailure | undefined> {
	const out = await ask(() =>
		run("gh", [
			"run",
			"list",
			"--branch",
			branch,
			"--limit",
			"1",
			"--json",
			"conclusion,headSha,name,displayTitle",
		]),
	);
	const [last] = rows(out);
	if (last === undefined) return undefined;
	const conclusion = field(last, "conclusion");
	if (conclusion === undefined || !FAILED.has(conclusion)) return undefined;
	return {
		branch,
		sha: (field(last, "headSha") ?? "").slice(0, 7),
		name: field(last, "name") ?? field(last, "displayTitle") ?? "CI",
	};
}

async function pullRequest(
	run: Runner,
	since: number | undefined,
): Promise<OpenPullRequest | undefined> {
	const out = await ask(() =>
		run("gh", ["pr", "list", "--author", "@me", "--limit", "10", "--json", PR_FIELDS]),
	);
	for (const pr of rows(out)) {
		const number = numberOf(pr);
		const title = field(pr, "title");
		if (number === undefined || title === undefined) continue;
		if (field(pr, "reviewDecision") === "CHANGES_REQUESTED")
			return { number, title, waits: "changes requested" };
		if (hasNewComment(pr, since)) return { number, title, waits: "new comment" };
	}
	return undefined;
}

function hasNewComment(pr: Record<string, unknown>, since: number | undefined): boolean {
	if (since === undefined) return false;
	const me = loginOf(pr["author"]);
	const comments = pr["comments"];
	if (!Array.isArray(comments)) return false;
	return comments.some((comment) => {
		if (!isObject(comment)) return false;
		const at = Date.parse(field(comment, "createdAt") ?? "");
		const login = loginOf(comment["author"]);
		return Number.isFinite(at) && at > since && login !== undefined && login !== me;
	});
}

function loginOf(value: unknown): string | undefined {
	return isObject(value) ? field(value, "login") : undefined;
}

async function ask(question: () => Promise<string>): Promise<string | undefined> {
	try {
		return await question();
	} catch {
		return undefined;
	}
}

function rows(out: string | undefined): Record<string, unknown>[] {
	if (out === undefined) return [];
	let value: unknown;
	try {
		value = JSON.parse(out);
	} catch {
		return [];
	}
	return Array.isArray(value) ? value.filter(isObject) : [];
}

function field(row: Record<string, unknown>, key: string): string | undefined {
	const value = row[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function numberOf(pr: Record<string, unknown>): number | undefined {
	const value = pr["number"];
	return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

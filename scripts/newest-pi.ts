#!/usr/bin/env bun
// The steps of `.github/workflows/newest-pi.yml`. `compare` says whether to test the newest pi, and
// `report` opens a bump PR when verify passed, or an issue when it failed.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { $ } from "bun";

const PACKAGES = ["pi-ai", "pi-coding-agent", "pi-tui"];
const LABEL = "newest-pi";
const BRANCH = "newest-pi";
const PI = "https://github.com/earendil-works/pi";

function setOutputs(values: Record<string, string>): void {
	const file = process.env.GITHUB_OUTPUT;
	const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	if (file) appendFileSync(file, `${lines.join("\n")}\n`);
	else console.log(lines.join("\n"));
}

const manifest = JSON.parse(readFileSync("package.json", "utf-8")) as {
	devDependencies: Record<string, string>;
};

function pinned(name: string): string {
	return (manifest.devDependencies[`@earendil-works/${name}`] ?? "").replace(/^[\^~]/, "");
}

async function newest(name: string): Promise<string> {
	const response = await fetch(`https://registry.npmjs.org/@earendil-works/${name}/latest`);
	return ((await response.json()) as { version: string }).version;
}

async function openIssues(): Promise<number[]> {
	const json = await $`gh issue list --label ${LABEL} --state open --json number`.text();
	return (JSON.parse(json) as { number: number }[]).map((issue) => issue.number);
}

// A scheduled run tests only when a pin moved or an issue is still open.
async function compare(): Promise<void> {
	const versions = await Promise.all(PACKAGES.map(newest));
	const moved = PACKAGES.some((name, index) => pinned(name) !== versions[index]);
	const scheduled = process.env.GITHUB_EVENT_NAME === "schedule";
	const open = (await openIssues()).length > 0;
	setOutputs({
		test: String(!scheduled || moved || open),
		pinned: pinned("pi-coding-agent"),
		newest: await newest("pi-coding-agent"),
	});
}

async function releaseNotes(version: string): Promise<string> {
	const result = await $`gh api repos/earendil-works/pi/releases/tags/v${version} --jq .body`
		.quiet()
		.nothrow();
	return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

function details(summary: string, body: string): string[] {
	return [`<details><summary>${summary}</summary>`, "", body, "", "</details>"];
}

async function report(): Promise<void> {
	const passed = process.env.VERIFY === "success";
	const version = process.env.NEWEST ?? "";
	const pinnedVersion = process.env.PINNED ?? "";
	const run = process.env.RUN_URL ?? "";
	const notes = await releaseNotes(version);
	const range =
		pinnedVersion === version
			? `pinned here: \`${version}\` already, so this only re-ran the check`
			: `\`${pinnedVersion}\` → \`${version}\` ([compare](${PI}/compare/v${pinnedVersion}...v${version}))`;
	const links = [
		`- ${range}`,
		`- [run](${run})`,
		`- [release notes](${PI}/releases/tag/v${version})`,
	];
	const changes = notes ? details(`What pi ${version} changed`, notes) : [];

	if (!passed) {
		const log = readFileSync("verify.log", "utf-8").split("\n").slice(-120).join("\n");
		await fileIssue(version, [
			`The newest \`@earendil-works/pi-coding-agent\` is \`${version}\`, and \`bun run verify\` fails against it. A type or test failure is an API change. A \`pi:defaults\` failure is a default the harness's settings were chosen against.`,
			"",
			...links,
			"",
			...details("Tail of the log", `\`\`\`text\n${log}\n\`\`\``),
			"",
			...changes,
		]);
		return;
	}

	const bumped = (await $`git diff --quiet -- package.json`.nothrow()).exitCode !== 0;
	if (bumped) {
		await openPullRequest(version, [
			`pi released \`${version}\`, and the whole suite passes against it, the API and the defaults included.`,
			"",
			...links,
			"",
			...changes,
			"",
			"The `CI` run on this PR waits in `action_required` until a maintainer approves it, which is how GitHub treats a pull request opened by `github-actions[bot]`.",
		]);
	}
	const green = `\`${version}\` runs green again: ${run}`;
	await Promise.all(
		(await openIssues()).map((number) => $`gh issue close ${number} --comment ${green}`),
	);
}

// One open issue at a time, and a version already reported is not repeated.
async function fileIssue(version: string, body: string[]): Promise<void> {
	const title = `pi SDK ${version} fails the suite`;
	writeFileSync("body.md", body.join("\n"));
	await $`gh label create ${LABEL} --description ${"Fails against the latest pi SDK"} --color f9d0c4 --force`;

	const [number] = await openIssues();
	if (number === undefined) {
		await $`gh issue create --title ${title} --label ${LABEL} --body-file body.md`;
		return;
	}
	const thread =
		await $`gh issue view ${number} --json body,comments --jq ${'.body + ([.comments[].body] | join("\n"))'}`.text();
	if (thread.includes(`\`${version}\``)) return;
	await $`gh issue edit ${number} --title ${title}`;
	await $`gh issue comment ${number} --body-file body.md`;
}

async function openPullRequest(version: string, body: string[]): Promise<void> {
	const title = `chore(deps): bump the pi SDK to ${version}`;
	writeFileSync("body.md", body.join("\n"));
	await $`git config user.name ${"github-actions[bot]"}`;
	await $`git config user.email ${"41898282+github-actions[bot]@users.noreply.github.com"}`;
	await $`git checkout -B ${BRANCH}`;
	await $`git add package.json bun.lock`;
	await $`git commit -m ${title}`;
	await $`git push --force origin ${BRANCH}`;

	const open =
		await $`gh pr list --head ${BRANCH} --state open --json number --jq ${".[0].number // empty"}`.text();
	if (open.trim()) await $`gh pr edit ${open.trim()} --title ${title} --body-file body.md`;
	else await $`gh pr create --title ${title} --body-file body.md --head ${BRANCH} --base main`;
}

const command = process.argv[2];
if (command === "compare") await compare();
else if (command === "report") await report();
else throw new Error("usage: bun scripts/newest-pi.ts compare|report");

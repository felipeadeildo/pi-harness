#!/usr/bin/env bun
// The steps of `.github/workflows/newest-web-access.yml`. `compare` says whether to test the newest
// pi-web-access, and `report` opens a bump PR when verify passed, or an issue when it failed.
import { readFileSync } from "node:fs";

import { $ } from "bun";

import {
	closeIssues,
	details,
	fileIssue,
	filesChanged,
	logTail,
	openIssues,
	openPullRequest,
	setOutputs,
} from "./github.ts";

const NAME = "pi-web-access";
const MANIFEST = "packages/web/package.json";
const LABEL = "newest-web-access";
const BRANCH = "newest-web-access";
const REPO = "nicobailon/pi-web-access";
const WEB = `https://github.com/${REPO}`;

function pinned(): string {
	const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as {
		dependencies: Record<string, string>;
	};
	return manifest.dependencies[NAME] ?? "";
}

async function compare(): Promise<void> {
	const response = await fetch(`https://registry.npmjs.org/${NAME}/latest`);
	const newest = ((await response.json()) as { version: string }).version;
	const event = process.env.GITHUB_EVENT_NAME;
	const open = (await openIssues(LABEL)).length > 0;
	setOutputs({
		test: String(
			pinned() !== newest || event === "workflow_dispatch" || (event === "schedule" && open),
		),
		pinned: pinned(),
		newest,
	});
}

async function changes(version: string): Promise<string[]> {
	const result = await $`gh api repos/${REPO}/releases/tags/v${version} --jq .body`
		.quiet()
		.nothrow();
	const notes = result.exitCode === 0 ? result.stdout.toString().trim() : "";
	return notes ? details(`What pi-web-access ${version} changed`, notes) : [];
}

async function report(): Promise<void> {
	const passed = process.env.VERIFY === "success";
	const version = process.env.NEWEST ?? "";
	const before = process.env.PINNED ?? "";
	const run = process.env.RUN_URL ?? "";
	const range =
		before === version
			? `pinned here: \`${version}\` already, so this only re-ran the check`
			: `\`${before}\` → \`${version}\` ([compare](${WEB}/compare/v${before}...v${version}))`;
	const links = [`- ${range}`, `- [run](${run})`, `- [changelog](${WEB}/blob/main/CHANGELOG.md)`];

	if (!passed) {
		await fileIssue(
			{
				label: LABEL,
				description: "Fails against the latest pi-web-access",
				color: "f9d0c4",
				title: `pi-web-access ${version} fails the suite`,
				trailingNewline: false,
				skipWhenMentions: `\`${version}\``,
			},
			[
				`The newest \`pi-web-access\` is \`${version}\`, and \`bun run verify\` fails against it. A failure in \`packages/web/test/contract.test.ts\` means it no longer accepts the harness's web config, or reads it from another place.`,
				"",
				...links,
				"",
				...logTail(),
				"",
				...(await changes(version)),
			],
		);
		return;
	}

	if (await filesChanged([MANIFEST])) {
		await openPullRequest(
			{
				branch: BRANCH,
				title: `chore(deps): bump pi-web-access to ${version}`,
				files: [MANIFEST, "bun.lock"],
				trailingNewline: false,
			},
			[
				`pi-web-access released \`${version}\`, and the whole suite passes against it, the contract with the harness's web config included.`,
				"",
				...links,
				"",
				...(await changes(version)),
				"",
				"The `CI` run on this PR waits in `action_required` until a maintainer approves it, which is how GitHub treats a pull request opened by `github-actions[bot]`.",
			],
		);
	}
	await closeIssues(LABEL, `\`${version}\` runs green again: ${run}`);
}

const command = process.argv[2];
if (command === "compare") await compare();
else if (command === "report") await report();
else throw new Error("usage: bun scripts/newest-web-access.ts compare|report");

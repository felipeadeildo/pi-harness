#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
/**
 * Points npm's trusted publisher at the release workflow. Run locally: `npm trust` asks for 2FA.
 *
 * Usage: bun scripts/setup-npm-trust.ts [--list] [--dry-run] [--only a,b]
 */

import { interactive } from "./interactive.ts";
import { workspacePackages } from "./packages.ts";

const WORKFLOW = "release.yml";
const ENVIRONMENT = "npm-publish";

function repository(root: string): string {
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
		repository?: string | { url?: string };
	};
	// npm accepts both `"repository": "<url>"` and `"repository": { "url": "<url>" }`.
	const url =
		typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
	const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url ?? "");
	if (match?.[1] === undefined) throw new Error("package.json has no GitHub repository");
	return match[1];
}

async function main(): Promise<void> {
	const root = resolve(import.meta.dir, "..");
	const argv = process.argv.slice(2);
	const list = argv.includes("--list");
	const dryRun = argv.includes("--dry-run") ? ["--dry-run"] : [];
	const only = argv.includes("--only") ? (argv[argv.indexOf("--only") + 1] ?? "").split(",") : [];
	const repo = repository(root);

	const packages = workspacePackages(root).filter(
		(pkg) => only.length === 0 || only.includes(pkg.name),
	);
	if (packages.length === 0) throw new Error("no package to configure");

	for (const pkg of packages) {
		console.log(`\n${pkg.name}`);
		if (list) {
			// oxlint-disable-next-line no-await-in-loop -- npm trust is interactive, so one at a time
			await interactive(["npm", "trust", "list", pkg.name]);
			continue;
		}
		// oxlint-disable-next-line no-await-in-loop -- npm trust is interactive, so one at a time
		await interactive([
			"npm",
			"trust",
			"github",
			pkg.name,
			"--file",
			WORKFLOW,
			"--repo",
			repo,
			"--env",
			ENVIRONMENT,
			"--allow-publish",
			"--yes",
			...dryRun,
		]);
	}
}

await main();

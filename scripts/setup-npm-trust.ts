#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Point npm's trusted publisher at this repository's release workflow, for every package.
 *
 * Run this locally, not in CI: `npm trust` asks for two-factor auth. The first call prompts, and
 * on the npm site you can skip 2FA for the next few minutes so the rest run unattended.
 *
 * Usage: bun scripts/setup-npm-trust.ts [--list] [--dry-run] [--only a,b]
 */
import { $ } from "bun";

import { workspacePackages } from "./packages.ts";

const WORKFLOW = "release.yml";
const ENVIRONMENT = "npm-publish";

function repository(root: string): string {
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
		repository: string;
	};
	const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(manifest.repository);
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
			await $`npm trust list ${pkg.name}`.nothrow();
			continue;
		}
		await $`npm trust github ${pkg.name} --file ${WORKFLOW} --repo ${repo} --env ${ENVIRONMENT} --allow-publish --yes ${dryRun}`.nothrow();
	}
}

await main();

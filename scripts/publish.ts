#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Publish the workspace packages to npm, in dependency order, from the packed tarball.
 *
 * A version already on the registry is skipped, so a release that died halfway can be run again.
 * Packages that depend on a failure wait; unrelated ones still go out.
 *
 * Usage:
 *   bun scripts/publish.ts                  # everything, in order
 *   bun scripts/publish.ts --dry-run        # pack and check, publish nothing
 *   bun scripts/publish.ts --paths a,b      # only these package folders
 *   bun scripts/publish.ts --tarballs <dir> # leave the tarballs in a directory
 */
import { $ } from "bun";

import { publishablePackages, type WorkspacePackage, workspacePackages } from "./packages.ts";
import { checkTarball, packAll, tarballVersion, type PackedPackage } from "./tarballs.ts";

interface Options {
	dryRun: boolean;
	paths: string[];
	tarballDir: string;
}

function parseArguments(argv: readonly string[]): Options {
	const options: Options = { dryRun: false, paths: [], tarballDir: "" };
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--dry-run") options.dryRun = true;
		else if (argument === "--paths")
			options.paths = (argv[++index] ?? "").split(",").filter(Boolean);
		else if (argument === "--tarballs") options.tarballDir = argv[++index] ?? "";
		else throw new Error(`unknown argument: ${argument}`);
	}
	return options;
}

async function isPublished(name: string, version: string): Promise<boolean> {
	const result = await $`npm view ${`${name}@${version}`} version`.quiet().nothrow();
	return result.exitCode === 0;
}

function isBlocked(
	pkg: WorkspacePackage,
	failed: ReadonlySet<string>,
	workspace: ReadonlySet<string>,
): boolean {
	return pkg.dependsOn.some((name) => workspace.has(name) && failed.has(name));
}

async function main(): Promise<void> {
	const root = resolve(import.meta.dir, "..");
	const options = parseArguments(process.argv.slice(2));
	const publishable = publishablePackages(root);
	const selected =
		options.paths.length === 0
			? publishable
			: publishable.filter((pkg) => options.paths.includes(pkg.dir));

	if (selected.length === 0) {
		console.log("Nothing to publish.");
		return;
	}

	const tarballDir =
		options.tarballDir === ""
			? mkdtempSync(join(tmpdir(), "pi-harness-tarballs-"))
			: options.tarballDir;
	console.log(`Packing ${selected.length} package(s) into ${tarballDir}\n`);
	const packed = await packAll(root, selected);
	const read = await Promise.all(packed.map((entry) => tarballVersion(entry)));
	const versions = new Map(packed.map((entry, index) => [entry.pkg.name, read[index] ?? ""]));

	const workspaceVersions = new Map(workspacePackages(root).map((pkg) => [pkg.name, pkg.version]));
	const problems = (
		await Promise.all(packed.map((entry) => checkTarball(entry, workspaceVersions)))
	).flat();
	if (problems.length > 0) {
		for (const problem of problems) console.error(`  ${problem}`);
		throw new Error("the tarballs are not publishable");
	}
	for (const entry of packed) {
		console.log(`  ${entry.pkg.name}@${versions.get(entry.pkg.name)} (${entry.pkg.dir})`);
	}

	const workspace = new Set(publishable.map((pkg) => pkg.name));
	const failed = new Set<string>();
	const blocked: string[] = [];

	for (const entry of packed) {
		const version = versions.get(entry.pkg.name) ?? "";
		if (isBlocked(entry.pkg, failed, workspace)) {
			blocked.push(entry.pkg.name);
			console.log(`\n- ${entry.pkg.name}@${version} waits for a dependency that failed`);
			continue;
		}
		// oxlint-disable-next-line no-await-in-loop -- publishing is sequential, in dependency order
		if (await isPublished(entry.pkg.name, version)) {
			console.log(`\n= ${entry.pkg.name}@${version} is already on npm`);
			continue;
		}
		if (options.dryRun) {
			console.log(`\n+ ${entry.pkg.name}@${version} would be published`);
			continue;
		}

		console.log(`\n+ ${entry.pkg.name}@${version}`);
		// oxlint-disable-next-line no-await-in-loop -- one publish at a time, in dependency order
		const result = await publish(entry);
		if (result === 0) continue;

		failed.add(entry.pkg.name);
		console.error(`  failed with exit code ${result}`);
	}

	if (options.tarballDir === "") rmSync(tarballDir, { recursive: true, force: true });

	if (failed.size > 0) {
		console.error(`\nFailed: ${[...failed].join(", ")}`);
		if (blocked.length > 0) console.error(`Waiting on them: ${blocked.join(", ")}`);
		console.error("Run it again once the failure is fixed. Published versions are skipped.");
		process.exit(1);
	}
	console.log("\nDone.");
}

async function publish(entry: PackedPackage): Promise<number> {
	const provenance = process.env.GITHUB_ACTIONS === "true" ? ["--provenance"] : [];
	const result = await $`npm publish ${entry.tarball} --access public ${provenance}`.nothrow();
	return result.exitCode;
}

await main();

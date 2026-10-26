import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";

// Packing a package the way `npm publish` will see it. `bun pm pack` resolves the `workspace:`
// ranges npm cannot.
import { $ } from "bun";

import type { WorkspacePackage } from "./packages.ts";

export interface PackedPackage {
	readonly pkg: WorkspacePackage;
	readonly tarball: string;
}

export async function packPackage(
	root: string,
	pkg: WorkspacePackage,
	into: string,
): Promise<PackedPackage> {
	// A package's `prepack` may print its build first; the tarball's path is the last line.
	const output = await $`bun pm pack --destination ${into} --quiet`.cwd(join(root, pkg.dir)).text();
	const printed = output.trim().split("\n").at(-1)?.trim() ?? "";
	return { pkg, tarball: isAbsolute(printed) ? printed : join(into, printed) };
}

export async function packAll(
	root: string,
	packages: readonly WorkspacePackage[],
): Promise<PackedPackage[]> {
	const into = mkdtempSync(join(tmpdir(), "pi-harness-pack-"));
	const packed: PackedPackage[] = [];
	for (const pkg of packages) {
		// oxlint-disable-next-line no-await-in-loop -- one at a time, `bun pm pack` uses the shared cwd
		packed.push(await packPackage(root, pkg, into));
	}
	return packed;
}

/** What is wrong with each tarball, as one line per problem. Empty when every one can ship. */
export async function checkTarballs(
	packed: readonly PackedPackage[],
	workspace: readonly WorkspacePackage[],
): Promise<string[]> {
	const versions = new Map(workspace.map((pkg) => [pkg.name, pkg.version]));
	const problems = await Promise.all(packed.map((entry) => checkTarball(entry, versions)));
	return problems.flat();
}

// Unresolved `workspace:` ranges, workspace dependencies at another version than the release (bun.lock
// lagging release-please), and `pi` manifests or `files` entries the tarball does not carry.
async function checkTarball(
	packed: PackedPackage,
	versions: ReadonlyMap<string, string>,
): Promise<string[]> {
	const problems: string[] = [];
	const manifest = JSON.parse(await tarRead(packed.tarball, "package/package.json")) as Record<
		string,
		unknown
	>;

	for (const section of ["dependencies", "peerDependencies"]) {
		for (const [name, range] of Object.entries(
			(manifest[section] ?? {}) as Record<string, unknown>,
		)) {
			if (typeof range !== "string") continue;
			if (range.startsWith("workspace:")) {
				problems.push(`${section}.${name} is still ${range}`);
				continue;
			}
			const current = versions.get(name);
			if (current !== undefined && range !== current) {
				problems.push(
					`${section}.${name} is ${range}, but the workspace has ${current}. Run bun install to refresh bun.lock`,
				);
			}
		}
	}

	const entries = (await $`tar -tzf ${packed.tarball}`.text()).split("\n");
	for (const path of packed.pkg.extensions) {
		const inside = `package/${path.replace(/^\.\//, "")}`;
		if (!entries.includes(inside))
			problems.push(`${path} is declared in the pi manifest but missing`);
	}

	// A folder the package lists in `files` and does not carry is a build that did not run, as a
	// `dist` left out by a pack without its `prepack`.
	for (const listed of (manifest.files ?? []) as string[]) {
		const inside = `package/${listed.replace(/^\.\//, "").replace(/\/$/, "")}`;
		if (!entries.some((entry) => entry === inside || entry.startsWith(`${inside}/`)))
			problems.push(`${listed} is listed in files but missing`);
	}

	return problems.map((problem) => `${packed.pkg.name}: ${problem}`);
}

export async function tarballVersion(packed: PackedPackage): Promise<string> {
	const manifest = JSON.parse(await tarRead(packed.tarball, "package/package.json")) as {
		version: string;
	};
	return manifest.version;
}

async function tarRead(tarball: string, path: string): Promise<string> {
	return await $`tar -xzOf ${tarball} ${path}`.text();
}

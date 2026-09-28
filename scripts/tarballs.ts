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
	const printed = (
		await $`bun pm pack --destination ${into} --quiet`.cwd(join(root, pkg.dir)).text()
	).trim();
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

// The two ways a package breaks without anyone noticing: an unresolved `workspace:` range, and a
// `pi` manifest pointing at a file the tarball does not carry.
export async function checkTarball(packed: PackedPackage): Promise<string[]> {
	const problems: string[] = [];
	const manifest = JSON.parse(await tarRead(packed.tarball, "package/package.json")) as Record<
		string,
		unknown
	>;

	for (const section of ["dependencies", "peerDependencies"]) {
		for (const [name, range] of Object.entries(
			(manifest[section] ?? {}) as Record<string, unknown>,
		)) {
			if (typeof range === "string" && range.startsWith("workspace:")) {
				problems.push(`${section}.${name} is still ${range}`);
			}
		}
	}

	const entries = (await $`tar -tzf ${packed.tarball}`.text()).split("\n");
	for (const path of packed.pkg.extensions) {
		const inside = `package/${path.replace(/^\.\//, "")}`;
		if (!entries.includes(inside))
			problems.push(`${path} is declared in the pi manifest but missing`);
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

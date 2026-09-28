// The workspace packages, in the order they can be published. A package whose dependency is not
// on the registry yet cannot be installed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface WorkspacePackage {
	/** Relative to the repository root, like `packages/kit`. */
	readonly dir: string;
	readonly name: string;
	readonly version: string;
	/** What the `pi` manifest points at, relative to the package root. */
	readonly extensions: readonly string[];
	readonly dependsOn: readonly string[];
	readonly private: boolean;
}

interface Manifest {
	name?: string;
	version?: string;
	private?: boolean;
	dependencies?: Record<string, unknown>;
	peerDependencies?: Record<string, unknown>;
	pi?: { extensions?: unknown };
}

export function workspacePackages(root: string): WorkspacePackage[] {
	const packages: WorkspacePackage[] = [];
	const dependencies = new Map<string, string[]>();

	for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;

		const dir = `packages/${entry.name}`;
		const manifest = readManifest(join(root, dir));
		if (manifest.name === undefined || manifest.version === undefined) continue;

		const dependsOn = dependencyNames(manifest);
		packages.push({
			dir,
			name: manifest.name,
			version: manifest.version,
			extensions: extensionPaths(manifest),
			dependsOn,
			private: manifest.private === true,
		});
		dependencies.set(manifest.name, dependsOn);
	}

	return sortedByDependency(packages, dependencies);
}

/** The ones that go to npm. The private ones are only rehearsed. */
export function publishablePackages(root: string): WorkspacePackage[] {
	return workspacePackages(root).filter((pkg) => !pkg.private);
}

function readManifest(packageDir: string): Manifest {
	const raw = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as Manifest;
	if (typeof raw.name !== "string" || typeof raw.version !== "string") {
		throw new Error(`${packageDir}/package.json needs a name and a version`);
	}
	return raw;
}

function extensionPaths(manifest: Manifest): string[] {
	const declared = manifest.pi?.extensions;
	if (!Array.isArray(declared)) return [];
	return declared.filter((entry): entry is string => typeof entry === "string");
}

function dependencyNames(manifest: Manifest): string[] {
	const names = [
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	];
	return names;
}

function sortedByDependency(
	packages: readonly WorkspacePackage[],
	dependencies: ReadonlyMap<string, readonly string[]>,
): WorkspacePackage[] {
	const byName = new Map(packages.map((entry) => [entry.name, entry]));
	const sorted: WorkspacePackage[] = [];
	const seen = new Set<string>();

	function visit(entry: WorkspacePackage): void {
		if (seen.has(entry.name)) return;
		seen.add(entry.name);
		for (const name of dependencies.get(entry.name) ?? []) {
			const dependency = byName.get(name);
			if (dependency !== undefined) visit(dependency);
		}
		sorted.push(entry);
	}

	for (const entry of packages) visit(entry);
	return sorted;
}

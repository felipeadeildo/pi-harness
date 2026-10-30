import { getAgentDir, type PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";

const NAME = /(^|[/:@])pi-web-access(@[^/]*)?\/?$/;

/** The pi-web-access the person installed on its own, which would register the same tools. */
export function standaloneSource(packages: readonly PackageSource[]): string | undefined {
	for (const entry of packages) {
		if (typeof entry !== "string" && entry.extensions?.length === 0) continue;
		const source = typeof entry === "string" ? entry : entry.source;
		if (NAME.test(source.replace(/\.git$/, ""))) return source;
	}
	return undefined;
}

export function installedPackages(cwd: string): PackageSource[] {
	const settings = SettingsManager.create(cwd, getAgentDir());
	return [
		...(settings.getGlobalSettings().packages ?? []),
		...(settings.getProjectSettings().packages ?? []),
	];
}

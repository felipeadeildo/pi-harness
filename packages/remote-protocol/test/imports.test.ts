import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE = join(import.meta.dir, "..", "src");
const REPO = join(import.meta.dir, "..", "..", "..");
function sources(folder = SOURCE): string[] {
	return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return sources(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

describe("the package stands alone", () => {
	test("no source imports anything but the package itself", () => {
		const outside: string[] = [];
		for (const file of sources()) {
			for (const match of readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)) {
				const target = match[1] ?? "";
				if (!target.startsWith("./") && !target.startsWith("../")) {
					outside.push(`${file}: ${target}`);
				}
			}
		}
		expect(outside).toEqual([]);
	});

	test("it bundles with nothing outside it, which is how the daemon takes it", async () => {
		const built = await Bun.build({
			entrypoints: [join(SOURCE, "index.ts")],
			target: "bun",
			packages: "external",
			metafile: true,
		});
		expect(built.success).toBe(true);
		// bun reports an input relative to the entrypoint, so the check resolves each path against the
		// package root: the property is "nothing from outside", not how the path was written.
		const inside = (path: string): boolean =>
			path.startsWith("node:") || !relative(REPO, join(REPO, path)).startsWith("..");
		const inputs = Object.entries(built.metafile?.inputs ?? {});
		const outside = inputs.flatMap(([file, input]) =>
			[file, ...input.imports.map((one) => one.path)].filter((path) => !inside(path)),
		);
		expect(outside).toEqual([]);
	});
});

// The policy module belongs to the daemon, and the app only reaches it from a script that runs under
// bun. An import from `src/` would pull `node:crypto` into the web bundle, and the export would fail
// or, worse, ship a page that cannot hash itself.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

function files(at: string): string[] {
	return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
		const path = join(at, entry.name);
		if (entry.isDirectory()) return files(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

describe("the web bundle", () => {
	test("never reaches a Node module, by the subpath or through the package's source", () => {
		// A co-located test reads a fixture with `node:fs` and is never bundled, so it is out of scope.
		const reaching = files(SRC)
			.filter((file) => !/\.test\.tsx?$/.test(file))
			.filter((file) => {
				const text = readFileSync(file, "utf8");
				// Any spelling counts: single quotes, `import()`, `require()` and a plain mention, so a
				// new way of writing the same import cannot slip past the guard.
				return /node:|pi-remote\/web|packages\/remote\//.test(text);
			});
		expect(reaching).toEqual([]);
	});
});

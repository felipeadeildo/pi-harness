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
	test("never imports the policy module, which is the daemon's", () => {
		const importing = files(SRC).filter((file) =>
			readFileSync(file, "utf8").includes("pi-remote/web"),
		);
		expect(importing).toEqual([]);
	});
});

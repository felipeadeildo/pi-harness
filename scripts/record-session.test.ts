import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { PRIVATE, scrub } from "./record-session.ts";

const FIXTURES = join(import.meta.dir, "..", "packages", "remote-protocol", "test", "fixtures");

describe("a recording leaves this machine out", () => {
	test("takes the folders it ran in, and the home it read from, out of the text", () => {
		const text = [
			`the run worked in ${join(homedir(), "Projects", "pi-harness.worktrees", "protocol")}`,
			`and read ${join(homedir(), ".pi", "agent")}`,
		].join(" ");

		const checkout = join(homedir(), "Projects", "pi-harness.worktrees", "protocol");
		const scrubbed = scrub(text, [checkout, homedir()]);

		expect(scrubbed).not.toContain(homedir());
		expect(scrubbed).not.toContain("worktrees");
		expect(scrubbed).toContain("/session");
	});

	test("takes out the path pi prints for its own packages", () => {
		const text = `documentation: ${join(homedir(), "node_modules", ".bun", "pi@1.4.0", "docs")}`;

		expect(scrub(text, [])).toBe("documentation: /node_modules/…");
	});

	test("fails instead of writing a path it does not know", () => {
		expect(() => scrub(`a session in ${join(homedir(), "somewhere")}`, [])).toThrow(
			"the recording still names",
		);
	});

	test("the fixtures in the repository hold none of it", () => {
		for (const folder of readdirSync(FIXTURES)) {
			for (const file of readdirSync(join(FIXTURES, folder))) {
				const text = readFileSync(join(FIXTURES, folder, file), "utf8");
				for (const part of PRIVATE) expect(text).not.toContain(part);
				// A recording names folders it made up, never one this machine has.
				expect(text).not.toMatch(/\/(?:home|Users|root|tmp)\/[\w.-]/);
			}
		}
	});
});

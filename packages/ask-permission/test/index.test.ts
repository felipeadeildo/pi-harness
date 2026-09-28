import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakePi } from "@adeildo/pi-kit/testing";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { configPath } from "#core/config/store.ts";

import piAskPermission from "../src/index.ts";

let dir: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.PI_CODING_AGENT_DIR;
	dir = mkdtempSync(join(tmpdir(), "pi-ask-index-"));
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});

test("loading the extension writes nothing until a session starts", async () => {
	const fake = fakePi();
	piAskPermission(fake.pi);
	expect(existsSync(configPath())).toBe(false);

	const ctx = {
		mode: "print",
		hasUI: false,
		cwd: dir,
		isProjectTrusted: () => false,
		sessionManager: { getBranch: () => [] },
		ui: { notify: () => {}, setStatus: () => {} },
	} as unknown as ExtensionContext;
	await fake.fire("session_start", {}, ctx);
	expect(existsSync(configPath())).toBe(true);
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../src/app/builder.ts";
import { defineFeature } from "../src/app/feature.ts";
import { NAMES } from "../src/contracts/names.ts";
import { TASKS } from "../src/contracts/tasks.ts";
import { eventsDir, FolderFeed } from "../src/events/log.ts";
import { names } from "../src/names/feature.ts";
import { WORDS } from "../src/names/words.ts";
import { emptyTasks } from "../src/tasks/state.ts";
import { fakeContext, fakePi } from "../src/testing.ts";

let root: string;
let dir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "names-"));
	dir = join(root, "names");
	process.env.PI_HARNESS_EVENTS = join(root, "events");
});

afterEach(() => {
	delete process.env.PI_HARNESS_EVENTS;
	rmSync(root, { recursive: true, force: true });
});

const session = { getSessionId: () => "01a16a75-d3d6" };
const ctx = () =>
	fakeContext([], true, {
		sessionManager: { getCwd: () => "/repo", getSessionId: session.getSessionId },
	});

/** A feature that answers the tasks contract, standing in for the tasks feature. */
function holding(handle: string) {
	return defineFeature({
		id: "holder",
		description: "holds a tasks state",
		setup: (scope) => TASKS.provide(scope, () => ({ state: { ...emptyTasks(), handle } })),
	});
}

function mounted(handle?: string) {
	const fake = fakePi();
	const app = createApp(fake.pi, { name: "test", settingsPath: join(root, "settings.json") });
	if (handle !== undefined) app.use(holding(handle));
	app.use(names({ dir })).build();
	return fake;
}

function current(fake: ReturnType<typeof fakePi>) {
	return NAMES.current({ events: fake.pi.events, warn: () => {} });
}

describe("the names feature", () => {
	test("draws a word on the first start, and says so in the log", async () => {
		const fake = mounted();
		await fake.fire("session_start", {}, ctx());
		const value = current(fake);
		expect(value).toBeDefined();
		expect((WORDS as readonly string[]).includes(value?.handle ?? "")).toBe(true);
		const logged = new FolderFeed(eventsDir("/repo"))
			.read()
			.filter((event) => event.type === "session.named");
		expect(logged.map((event) => event.data)).toEqual([{ handle: value?.handle as string }]);
	});

	test("a session that comes back keeps its word", async () => {
		const first = mounted();
		await first.fire("session_start", {}, ctx());
		const drawn = current(first)?.handle;
		const again = mounted();
		await again.fire("session_start", {}, ctx());
		expect(current(again)?.handle).toBe(drawn as string);
	});

	test("a session that already has a handle from the tasks keeps it, and the claim survives the tasks", async () => {
		const fake = mounted("oauth");
		await fake.fire("session_start", {}, ctx());
		expect(current(fake)?.handle).toBe("oauth");
		const logged = new FolderFeed(eventsDir("/repo"))
			.read()
			.filter((event) => event.type === "session.named");
		expect(logged.map((event) => event.data)).toEqual([{ handle: "oauth" }]);
		const after = mounted();
		await after.fire("session_start", {}, ctx());
		expect(current(after)?.handle).toBe("oauth");
	});

	test("a rename logs the word it left, which mentions keep resolving", async () => {
		const fake = mounted();
		await fake.fire("session_start", {}, ctx());
		const before = current(fake)?.handle as string;
		const command = fake.commands.get("name");
		expect(command).toBeDefined();
		await command?.handler("auth", ctx() as never);
		expect(current(fake)?.handle).toBe("auth");
		const renamed = new FolderFeed(eventsDir("/repo"))
			.read()
			.filter((event) => event.type === "session.renamed");
		expect(renamed.map((event) => event.data)).toEqual([{ from: before, to: "auth", by: "you" }]);
	});
});

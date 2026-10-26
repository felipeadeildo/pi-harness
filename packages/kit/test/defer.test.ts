// Deferred work never runs or reports after the session ends. The refusal is a real pi's.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createApp } from "../src/app/builder.ts";
import type { Feature, FeatureScope } from "../src/app/feature.ts";
import { createRig, type Rig } from "../src/rig.ts";
import { fakeContext, fakePi } from "../src/testing.ts";

setDefaultTimeout(20_000);

let root = "";
let rig: Rig | undefined;
const ran: string[] = [];

function feature(setup: Feature["setup"]): Feature {
	return { id: "deferred", description: "work that waits for the session", setup };
}

/** An app with one feature, and the two events a session has: it starts, and it ends. */
async function mounted(setup: Feature["setup"]) {
	const fake = fakePi();
	const notes: string[] = [];
	createApp(fake.pi, { name: "defer", settingsPath: join(tmpdir(), `defer-${process.pid}.json`) })
		.use(feature(setup))
		.build();
	const ctx = fakeContext(notes);
	await fake.fire("session_start", { type: "session_start", reason: "startup" }, ctx);
	return {
		notes,
		end: () => fake.fire("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx),
	};
}

afterEach(() => {
	ran.length = 0;
	rig?.dispose();
	rig = undefined;
	rmSync(root, { recursive: true, force: true });
});

test("work deferred while the session is up runs, and only once", async () => {
	const app = await mounted((scope: FeatureScope) => {
		scope.defer(() => ran.push("first"));
	});
	await Bun.sleep(30);
	expect(ran).toEqual(["first"]);
	await app.end();
});

test("work deferred with a delay waits for it while the session is up", async () => {
	const app = await mounted((scope: FeatureScope) => {
		scope.defer(() => ran.push("late"), 20);
	});
	expect(ran).toEqual([]);
	await Bun.sleep(60);
	expect(ran).toEqual(["late"]);
	await app.end();
});

test("a delayed deferral runs while the session is up, with nothing else holding the loop", async () => {
	const app = await mounted((scope: FeatureScope) => {
		scope.defer(() => ran.push("alone"), 10);
	});
	// The timer is not holding the loop open on its own; this sleep is the only anchor, and the work
	// still has to happen inside it.
	await Bun.sleep(40);
	expect(ran).toEqual(["alone"]);
	await app.end();
});

test("the session ending cancels what waits, and nothing runs after it", async () => {
	const app = await mounted((scope: FeatureScope) => {
		scope.defer(() => ran.push("too late"), 100);
	});
	await app.end();
	await Bun.sleep(150);
	expect(ran).toEqual([]);
});

test("work deferred from a shutdown hook never runs, because the session is over", async () => {
	const app = await mounted((scope: FeatureScope) => {
		scope.onShutdown(() => scope.defer(() => ran.push("from the hook")));
	});
	await app.end();
	await Bun.sleep(30);
	expect(ran).toEqual([]);
});

test("a deferral that fails for another reason is reported, not swallowed", async () => {
	const app = await mounted((scope: FeatureScope) => {
		scope.defer(() => {
			throw new Error("the read broke");
		});
	});
	await Bun.sleep(30);
	expect(app.notes.join("\n")).toContain("the read broke");
	await app.end();
});

test("a context the host refused ends the session instead of reporting it", async () => {
	root = mkdtempSync(join(tmpdir(), "kit-defer-"));
	const notes: string[] = [];
	let context: ExtensionContext | undefined;
	const extension = (pi: ExtensionAPI): void => {
		createApp(pi, { name: "defer" })
			.use(
				feature((scope) => {
					scope.onSessionStart((ctx) => {
						context = ctx;
						// A real pi takes the context away when the session ends and refuses it after
						// that; asking it for the status is what a deferral would do.
						scope.defer(() => {
							context?.ui.setStatus("defer", "still here");
							ran.push("after the end");
						}, 50);
						// Waits longer than the refusal: the session is over, so it must never run.
						scope.defer(() => ran.push("after the refusal"), 100);
					});
				}),
			)
			.build();
	};
	rig = await createRig({ root, extensions: [extension] });
	await rig.prompt("hello");
	rig.dispose();
	rig = undefined;
	await Bun.sleep(120);
	expect(ran).toEqual([]);
	expect(notes).toEqual([]);
});

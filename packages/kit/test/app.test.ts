import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import {
	createApp,
	defineEvent,
	defineFeature,
	type Feature,
	object,
	setting,
	string,
} from "../src/index.ts";
import { fakeContext, fakePi } from "../src/testing.ts";

let dir: string;
let settingsPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-kit-app-"));
	settingsPath = join(dir, "settings.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function feature(id: string, setup: Feature["setup"] = () => {}): Feature {
	return defineFeature({ id, setup });
}

describe("mounting", () => {
	test("mounts every feature it was given", () => {
		const { pi } = fakePi();
		const app = createApp(pi, { name: "test", settingsPath })
			.use(feature("one"))
			.use(feature("two"))
			.build();
		expect(app.has("one")).toBe(true);
		expect(app.has("two")).toBe(true);
	});

	test("a feature that throws turns into a warning and the rest still mount", async () => {
		const { pi, fire } = fakePi();
		const app = createApp(pi, { name: "test", settingsPath })
			.use(
				feature("broken", () => {
					throw new Error("boom");
				}),
			)
			.use(feature("fine"))
			.build();
		expect(app.has("broken")).toBe(false);
		expect(app.has("fine")).toBe(true);

		const notes: string[] = [];
		await fire("session_start", {}, fakeContext(notes));
		expect(notes).toEqual(["test: broken: failed to set up: boom"]);
	});

	test("the same feature twice in one app keeps the first", () => {
		const { pi } = fakePi();
		let setups = 0;
		const counted = feature("counted", () => void setups++);
		const app = createApp(pi, { name: "test", settingsPath }).use(counted).use(counted).build();
		expect(app.has("counted")).toBe(true);
		expect(setups).toBe(1);
	});
});

describe("two apps in one pi process", () => {
	test("the second copy of a feature stays off and says who has it", async () => {
		const bus = createEventBus();
		const harness = fakePi(bus);
		const standalone = fakePi(bus);
		let setups = 0;
		const shared = feature("subscription", () => void setups++);

		createApp(harness.pi, { name: "pi-harness", settingsPath }).use(shared).build();
		const copy = createApp(standalone.pi, { name: "pi-providers", settingsPath })
			.use(shared)
			.use(feature("hide"))
			.build();

		expect(setups).toBe(1);
		expect(copy.has("subscription")).toBe(false);
		expect(copy.has("hide")).toBe(true);

		const notes: string[] = [];
		await standalone.fire("session_start", {}, fakeContext(notes));
		expect(notes).toEqual([
			"pi-providers: subscription: already loaded by pi-harness, so this copy stays off",
		]);
	});

	test("an app that shut down gives its features up, as on a reload", async () => {
		const bus = createEventBus();
		const before = fakePi(bus);
		createApp(before.pi, { name: "old", settingsPath }).use(feature("subscription")).build();
		await before.fire("session_shutdown", { reason: "reload" }, fakeContext());

		const after = fakePi(bus);
		const app = createApp(after.pi, { name: "new", settingsPath })
			.use(feature("subscription"))
			.build();
		expect(app.has("subscription")).toBe(true);
	});

	test("features talk over typed events and drop payloads that do not decode", async () => {
		const bus = createEventBus();
		const changed = defineEvent("providers:account-changed", object({ account: string }));
		const heard: string[] = [];

		const listener = fakePi(bus);
		createApp(listener.pi, { name: "listener", settingsPath })
			.use(
				feature("statusline", (app) => void changed.on(app, ({ account }) => heard.push(account))),
			)
			.build();

		const speaker = fakePi(bus);
		const app = createApp(speaker.pi, { name: "speaker", settingsPath })
			.use(feature("rotation"))
			.build();
		changed.emit(app, { account: "work" });
		bus.emit(changed.channel, { account: 42 });

		expect(heard).toEqual(["work"]);
		const notes: string[] = [];
		await listener.fire("session_start", {}, fakeContext(notes));
		expect(notes).toEqual([
			"listener: providers:account-changed: ignored an event: providers:account-changed.account: expected a string",
		]);
	});
});

describe("the session lifecycle", () => {
	test("settings are loaded before any feature's session hook runs", async () => {
		const version = setting({ id: "feature.version", default: "none", decoder: string });
		const seen: string[] = [];
		const { pi, fire } = fakePi();
		createApp(pi, { name: "test", settingsPath })
			.use(
				defineFeature({
					id: "feature",
					settings: [version],
					setup: (app) => app.onSessionStart(() => void seen.push(version.get(app))),
				}),
			)
			.build();

		writeFileSync(settingsPath, JSON.stringify({ feature: { version: "from the file" } }));
		await fire("session_start", {}, fakeContext());
		expect(seen).toEqual(["from the file"]);
	});

	test("a failing session hook warns with the feature's name and does not stop the others", async () => {
		const ran: string[] = [];
		const { pi, fire } = fakePi();
		createApp(pi, { name: "test", settingsPath })
			.use(
				feature("first", (app) =>
					app.onSessionStart(() => {
						throw new Error("no network");
					}),
				),
			)
			.use(feature("second", (app) => app.onSessionStart(() => void ran.push("second"))))
			.build();

		const notes: string[] = [];
		await fire("session_start", {}, fakeContext(notes));
		expect(ran).toEqual(["second"]);
		expect(notes).toEqual(["test: first: failed to start the session: no network"]);
	});

	test("shutdown hooks run once per session, last registered first", async () => {
		const order: string[] = [];
		const { pi, fire } = fakePi();
		createApp(pi, { name: "test", settingsPath })
			.use(feature("watcher", (app) => app.onShutdown(() => void order.push("watcher"))))
			.use(feature("server", (app) => app.onShutdown(() => void order.push("server"))))
			.build();

		await fire("session_start", {}, fakeContext());
		await fire("session_shutdown", { reason: "quit" }, fakeContext());
		await fire("session_shutdown", { reason: "quit" }, fakeContext());
		expect(order).toEqual(["server", "watcher"]);

		await fire("session_start", {}, fakeContext());
		await fire("session_shutdown", { reason: "new" }, fakeContext());
		expect(order).toEqual(["server", "watcher", "server", "watcher"]);
	});

	test("without UI, warnings go to stderr", async () => {
		const { pi, fire } = fakePi();
		const app = createApp(pi, { name: "test", settingsPath }).build();
		const printed: unknown[] = [];
		const original = console.error;
		console.error = (line: unknown) => void printed.push(line);
		try {
			await fire("session_start", {}, fakeContext([], false));
			app.warn("somewhere", "something");
		} finally {
			console.error = original;
		}
		expect(printed).toEqual(["test: somewhere: something"]);
	});

	test("the factory only registers handlers", () => {
		const { pi, count } = fakePi();
		createApp(pi, { name: "test", settingsPath }).use(feature("quiet")).build();
		expect(count("session_start")).toBe(1);
		expect(count("session_shutdown")).toBe(1);
	});
});

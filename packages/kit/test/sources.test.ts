import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createEventBus,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import {
	askSource,
	provideSources,
	type SessionSource,
	type SourceCursor,
	type SourceItem,
} from "../src/contracts/sources.ts";
import { canOpenView, openView, provideViews } from "../src/contracts/views.ts";
import { HOST } from "../src/events/log.ts";
import { fileSource, sourceFor } from "../src/sources/file.ts";
import { piSource } from "../src/sources/pi.ts";
import { fakePi } from "../src/testing.ts";

const HEADER = { type: "session", version: 3, id: "s1", timestamp: "t", cwd: "/work" };

let next = 0;
function entry(fields: Record<string, unknown>): SessionEntry {
	next++;
	return { id: `e${next}`, parentId: null, timestamp: "t", ...fields } as SessionEntry;
}

function user(text: string): SessionEntry {
	return entry({ type: "message", message: { role: "user", content: text, timestamp: 0 } });
}

function assistant(tokens: number, stopReason = "stop"): SessionEntry {
	return entry({
		type: "message",
		message: {
			role: "assistant",
			content: [],
			provider: "anthropic",
			model: "opus",
			stopReason,
			timestamp: 0,
			usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens },
		},
	});
}

function sessionFile(...lines: object[]): string {
	const path = join(mkdtempSync(join(tmpdir(), "source-")), "s1.jsonl");
	writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
	return path;
}

function sessionRewrite(path: string, ...lines: object[]): void {
	writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

function append(path: string, ...lines: object[]): void {
	appendFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

/** Follows until `done` holds, then stops. */
async function collect(
	source: SessionSource,
	after: SourceCursor | undefined,
	done: (items: SourceItem[]) => boolean,
	meanwhile: () => void = () => {},
): Promise<SourceItem[]> {
	const items: SourceItem[] = [];
	const stop = source.follow(after, (item) => items.push(item));
	meanwhile();
	await until(() => done(items));
	stop();
	return items;
}

async function until(done: () => boolean, tries = 200): Promise<void> {
	if (done() || tries === 0) return;
	await Bun.sleep(5);
	return until(done, tries - 1);
}

function kinds(items: SourceItem[]): string[] {
	return items.map((item) => (item.kind === "entry" ? item.entry.id : item.kind));
}

describe("a session file as a source", () => {
	test("its snapshot comes from the header and the entries that change it", async () => {
		const path = sessionFile(
			HEADER,
			entry({ type: "model_change", provider: "openai", modelId: "gpt" }),
			entry({ type: "thinking_level_change", thinkingLevel: "high" }),
			entry({ type: "session_info", name: "Fix the release" }),
			user("hi"),
			assistant(1200),
		);
		const last = JSON.parse(readFileSync(path, "utf8").trim().split("\n").at(-1) ?? "{}");
		expect(await fileSource(path).snapshot()).toEqual({
			session: "s1",
			machine: HOST,
			cwd: "/work",
			name: "Fix the release",
			leafId: last.id,
			model: { provider: "anthropic", id: "opus" },
			thinkingLevel: "high",
			context: { tokens: 1200 },
		});
	});

	test("an aborted answer and a compaction leave the context unknown until the next answer", async () => {
		const aborted = await fileSource(
			sessionFile(HEADER, assistant(500), assistant(0, "aborted")),
		).snapshot();
		expect(aborted.context).toEqual({ tokens: 500 });
		const compacted = await fileSource(
			sessionFile(
				HEADER,
				assistant(500),
				entry({ type: "compaction", summary: "", firstKeptEntryId: "x", tokensBefore: 500 }),
			),
		).snapshot();
		expect(compacted.context).toBeUndefined();
	});

	test("a file with no header yet has no snapshot", async () => {
		const path = join(mkdtempSync(join(tmpdir(), "source-")), "missing.jsonl");
		await expect(fileSource(path).snapshot()).rejects.toThrow("no session");
	});

	test("follows the entries, with the snapshot first and again when it changes", async () => {
		const first = user("hi");
		const path = sessionFile(HEADER, first);
		const later = assistant(900);
		const items = await collect(
			fileSource(path, { every: 5 }),
			undefined,
			(got) => got.length >= 4,
			() => setTimeout(() => append(path, later), 20),
		);
		expect(kinds(items)).toEqual([first.id, "snapshot", later.id, "snapshot"]);
		const snapshots = items.flatMap((item) => (item.kind === "snapshot" ? [item.snapshot] : []));
		expect(snapshots.map((snapshot) => snapshot.leafId)).toEqual([first.id, later.id]);
	});

	test("starts after the cursor it is given", async () => {
		const a = user("a");
		const b = user("b");
		const items = await collect(
			fileSource(sessionFile(HEADER, a, b)),
			{ entry: a.id },
			(got) => got.length >= 2,
		);
		expect(kinds(items)).toEqual([b.id, "snapshot"]);
	});

	test("a cursor the file does not hold starts over, saying so", async () => {
		const a = user("a");
		const items = await collect(
			fileSource(sessionFile(HEADER, a)),
			{ entry: "gone" },
			(got) => got.length >= 3,
		);
		expect(kinds(items)).toEqual(["reset", a.id, "snapshot"]);
	});

	test("a cursor with nothing it reads starts over, saying so", async () => {
		const a = user("a");
		const items = await collect(fileSource(sessionFile(HEADER, a)), {}, (got) => got.length >= 3);
		expect(kinds(items)).toEqual(["reset", a.id, "snapshot"]);
	});

	test("goes on after its cursor without starting over again", async () => {
		const a = user("a");
		const b = user("b");
		const c = user("c");
		const path = sessionFile(HEADER, a, b);
		const items = await collect(
			fileSource(path, { every: 5 }),
			{ entry: a.id },
			(got) => kinds(got).includes(c.id),
			() => setTimeout(() => append(path, c), 20),
		);
		expect(kinds(items)).toEqual([b.id, "snapshot", c.id, "snapshot"]);
	});

	test("sends the snapshot again only when it changed", async () => {
		const a = user("a");
		const b = user("b");
		const path = sessionFile(HEADER, a);
		const items = await collect(
			fileSource(path, { every: 5 }),
			undefined,
			(got) => kinds(got).includes(b.id),
			() => {
				// A record that is not an entry changes nothing the snapshot says.
				setTimeout(() => append(path, { id: "not-an-entry" }), 20);
				setTimeout(() => append(path, b), 80);
			},
		);
		expect(kinds(items)).toEqual([a.id, "snapshot", b.id, "snapshot"]);
	});

	test("a file rewritten as another session starts over, header and all", async () => {
		const a = user("a");
		const x = user("x");
		const path = sessionFile(HEADER, a);
		const items = await collect(
			fileSource(path, { every: 5 }),
			undefined,
			(got) => got.length >= 5,
			() => setTimeout(() => sessionRewrite(path, { ...HEADER, id: "s2", cwd: "/other" }, x), 20),
		);
		expect(kinds(items)).toEqual([a.id, "snapshot", "reset", x.id, "snapshot"]);
		expect(items.at(-1)).toEqual({
			kind: "snapshot",
			snapshot: { session: "s2", machine: HOST, cwd: "/other", leafId: x.id },
		});
	});

	test("a file rewritten with the same entries sends nothing twice, and a new entry once", async () => {
		const a = user("a");
		const b = user("b");
		const path = sessionFile(HEADER, a);
		const items = await collect(
			fileSource(path, { every: 5 }),
			undefined,
			(got) => kinds(got).includes(b.id),
			() =>
				setTimeout(() => {
					writeFileSync(path, [HEADER, a, b].map((line) => `${JSON.stringify(line)} \n`).join(""));
				}, 20),
		);
		await Bun.sleep(20);
		expect(kinds(items)).toEqual([a.id, "snapshot", b.id, "snapshot"]);
	});
});

function session(entries: SessionEntry[], extra: Partial<ExtensionContext> = {}): ExtensionContext {
	return {
		cwd: "/work",
		model: { provider: "anthropic", id: "opus" },
		thinkingLevel: "medium",
		getContextUsage: () => ({ tokens: 3000, contextWindow: 200_000, percent: 1.5 }),
		sessionManager: {
			getEntries: () => entries,
			getSessionId: () => "s1",
			getSessionName: () => "Fix it",
			getLeafId: () => entries.at(-1)?.id ?? null,
		},
		...extra,
	} as unknown as ExtensionContext;
}

describe("this pi as a source", () => {
	test("its snapshot comes from the session's context", async () => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		await expect(source.snapshot()).rejects.toThrow("not started");
		const a = user("a");
		await fake.fire("session_start", {}, session([a]));
		expect(await source.snapshot()).toEqual({
			session: "s1",
			machine: HOST,
			cwd: "/work",
			name: "Fix it",
			leafId: a.id,
			model: { provider: "anthropic", id: "opus" },
			thinkingLevel: "medium",
			context: { tokens: 3000, window: 200_000 },
		});
	});

	test("sends what pi appends after an event, once, and ends with the session", async () => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		const a = user("a");
		const entries = [a];
		const ctx = session(entries);
		await fake.fire("session_start", {}, ctx);
		const items: SourceItem[] = [];
		source.follow(undefined, (item) => items.push(item));
		expect(kinds(items)).toEqual([a.id, "snapshot"]);

		// Pi writes the entry after the extensions hear of `message_end`.
		await fake.fire("message_end", {}, ctx);
		const b = assistant(10);
		entries.push(b);
		await fake.fire("turn_end", {}, ctx);
		await Bun.sleep(5);
		expect(kinds(items)).toEqual([a.id, "snapshot", b.id, "snapshot"]);

		await fake.fire("session_shutdown", {}, ctx);
		expect(items.at(-1)).toEqual({ kind: "ended" });
	});

	test("reads what pi writes after telling of `message_end`, with no other event", async () => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		const entries = [user("a")];
		const ctx = session(entries);
		await fake.fire("session_start", {}, ctx);
		const items: SourceItem[] = [];
		source.follow(undefined, (item) => items.push(item));
		await fake.fire("message_end", {}, ctx);
		const b = assistant(10);
		entries.push(b);
		await Bun.sleep(5);
		expect(kinds(items).slice(2)).toEqual([b.id, "snapshot"]);
	});

	test("sends the snapshot again only when it changed", async () => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		const ctx = session([user("a")]);
		await fake.fire("session_start", {}, ctx);
		const items: SourceItem[] = [];
		source.follow(undefined, (item) => items.push(item));
		await fake.fire("turn_end", {}, ctx);
		await Bun.sleep(5);
		expect(kinds(items).slice(1)).toEqual(["snapshot"]);
	});

	test.each([
		"session_tree",
		"model_select",
		"session_info_changed",
		"session_compact",
		"thinking_level_select",
		"message_end",
	])("hears a change after %s", async (event) => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		const entries = [user("a")];
		await fake.fire("session_start", {}, session(entries));
		const items: SourceItem[] = [];
		source.follow(undefined, (item) => items.push(item));
		await fake.fire(event, {}, session(entries, { thinkingLevel: "high" }));
		await Bun.sleep(5);
		expect(items.at(-1)).toMatchObject({ kind: "snapshot", snapshot: { thinkingLevel: "high" } });
	});

	test("a follower that stopped hears nothing more", async () => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		const a = user("a");
		const entries = [a];
		const ctx = session(entries);
		await fake.fire("session_start", {}, ctx);
		const items: SourceItem[] = [];
		const stop = source.follow(undefined, (item) => items.push(item));
		stop();
		entries.push(user("b"));
		await fake.fire("turn_end", {}, ctx);
		await fake.fire("session_shutdown", {}, ctx);
		await Bun.sleep(5);
		expect(kinds(items)).toEqual([a.id, "snapshot"]);
	});

	test("a follower that comes after the session ended hears so at once", async () => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		const ctx = session([user("a")]);
		await fake.fire("session_start", {}, ctx);
		await fake.fire("session_shutdown", {}, ctx);
		const items: SourceItem[] = [];
		source.follow(undefined, (item) => items.push(item));
		expect(items).toEqual([{ kind: "ended" }]);
	});

	test("starts after its cursor, and over when the session does not hold it", async () => {
		const fake = fakePi();
		const source = piSource(fake.pi);
		const a = user("a");
		const b = user("b");
		await fake.fire("session_start", {}, session([a, b]));
		const after: SourceItem[] = [];
		source.follow({ entry: a.id }, (item) => after.push(item));
		expect(kinds(after)).toEqual([b.id, "snapshot"]);
		const unknown: SourceItem[] = [];
		source.follow({ entry: "gone" }, (item) => unknown.push(item));
		expect(kinds(unknown)).toEqual(["reset", a.id, b.id, "snapshot"]);
		// What a newer cursor looks like to this source: none of the fields it reads.
		const unread: SourceItem[] = [];
		source.follow({}, (item) => unread.push(item));
		expect(kinds(unread)).toEqual(["reset", a.id, b.id, "snapshot"]);
	});
});

describe("finding a source", () => {
	test("a provider's source comes first, then the file of a session on this machine", () => {
		const events = createEventBus();
		const address = { session: "s1", machine: HOST, file: "/tmp/s1.jsonl" };
		expect(askSource(events, address)).toBeUndefined();
		expect(sourceFor(events, address)).toBeDefined();
		expect(sourceFor(events, { ...address, machine: "elsewhere" })).toBeUndefined();
		expect(sourceFor(events, { session: "s1", machine: HOST })).toBeUndefined();

		const provided = fileSource("/tmp/other.jsonl");
		const stop = provideSources(events, (asked) =>
			asked.machine === "elsewhere" ? provided : undefined,
		);
		expect(sourceFor(events, { ...address, machine: "elsewhere" })).toBe(provided);
		expect(sourceFor(events, address)).not.toBe(provided);
		stop();
		expect(askSource(events, { ...address, machine: "elsewhere" })).toBeUndefined();
	});
});

describe("asking for a view", () => {
	test("nobody shows it until a provider does", () => {
		const events = createEventBus();
		const address = { session: "s1", machine: HOST };
		expect(canOpenView(events)).toBe(false);
		expect(openView(events, address)).toBe(false);

		const opened: string[] = [];
		const stop = provideViews(events, (asked) => {
			opened.push(asked.session);
			return true;
		});
		expect(canOpenView(events)).toBe(true);
		expect(openView(events, address)).toBe(true);
		expect(opened).toEqual(["s1"]);
		stop();
		expect(canOpenView(events)).toBe(false);
	});

	test("a provider that is busy says so", () => {
		const events = createEventBus();
		provideViews(
			events,
			() => false,
			() => false,
		);
		expect(canOpenView(events)).toBe(false);
		expect(openView(events, { session: "s1", machine: HOST })).toBe(false);
	});
});

test("the follower bundles with nothing outside it but node:*, as the daemon bundles it", async () => {
	const build = await Bun.build({
		entrypoints: [join(import.meta.dir, "../src/sources/follow.ts")],
		target: "node",
		packages: "external",
		metafile: true,
	});
	expect(build.success).toBe(true);
	const outside = Object.values(build.metafile?.inputs ?? {})
		.flatMap((input) => input.imports)
		.filter((one) => one.external === true)
		.map((one) => one.path);
	expect(outside.length).toBeGreaterThan(0);
	expect(outside.filter((path) => !path.startsWith("node:"))).toEqual([]);
});

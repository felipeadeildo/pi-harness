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
	canOpenView,
	openView,
	provideSources,
	provideViews,
	type SessionSource,
	type SourceItem,
} from "../src/contracts/sources.ts";
import { HOST } from "../src/events/log.ts";
import { fileSource, openSource } from "../src/sources/file.ts";
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

function append(path: string, ...lines: object[]): void {
	appendFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

/** Follows until `done` holds, then stops. */
async function collect(
	source: SessionSource,
	after: string | undefined,
	done: (items: SourceItem[]) => boolean,
	meanwhile: () => void = () => {},
): Promise<SourceItem[]> {
	const items: SourceItem[] = [];
	const stop = source.follow(after === undefined ? undefined : { entry: after }, (item) =>
		items.push(item),
	);
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
			a.id,
			(got) => got.length >= 2,
		);
		expect(kinds(items)).toEqual([b.id, "snapshot"]);
	});

	test("a cursor the file does not hold starts over, saying so", async () => {
		const a = user("a");
		const items = await collect(
			fileSource(sessionFile(HEADER, a)),
			"gone",
			(got) => got.length >= 3,
		);
		expect(kinds(items)).toEqual(["reset", a.id, "snapshot"]);
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
	});
});

describe("finding a source", () => {
	test("a provider's source comes first, then the file of a session on this machine", () => {
		const events = createEventBus();
		const address = { session: "s1", machine: HOST, file: "/tmp/s1.jsonl" };
		expect(askSource(events, address)).toBeUndefined();
		expect(openSource(events, address)).toBeDefined();
		expect(openSource(events, { ...address, machine: "elsewhere" })).toBeUndefined();
		expect(openSource(events, { session: "s1", machine: HOST })).toBeUndefined();

		const provided = fileSource("/tmp/other.jsonl");
		const stop = provideSources(events, (asked) =>
			asked.machine === "elsewhere" ? provided : undefined,
		);
		expect(openSource(events, { ...address, machine: "elsewhere" })).toBe(provided);
		expect(openSource(events, address)).not.toBe(provided);
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

test("the follower imports only node:*, because the daemon bundles it", () => {
	const source = readFileSync(join(import.meta.dir, "../src/sources/follow.ts"), "utf8");
	const imports = [...source.matchAll(/^import[^"]*"([^"]+)"/gm)].map((match) => match[1]);
	expect(imports.length).toBeGreaterThan(0);
	expect(imports.filter((name) => !name?.startsWith("node:"))).toEqual([]);
});

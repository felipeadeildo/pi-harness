import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	eventsDir,
	FolderFeed,
	KEEP_LOGS_MS,
	liveDir,
	LOGGED_EVENT,
	logEvent,
	logPath,
	type LogTarget,
	pruneLogs,
	readFrom,
} from "../src/events/log.ts";

let root: string;
let dir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "events-"));
	dir = eventsDir("/home/me/repo", root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function target(session: string): LogTarget {
	return { dir, session };
}

test("a folder's logs live under one directory named like pi's session folders", () => {
	expect(dir).toBe(join(root, "--home-me-repo--"));
});

test("an event is appended to its session's log and published inside the process", () => {
	const published: unknown[] = [];
	const event = logEvent(
		target("s1"),
		{ emit: (_, data) => published.push(data) },
		"session.state",
		{
			state: "running",
		},
	);
	expect(published).toEqual([event]);
	const line = JSON.parse(readFileSync(logPath(target("s1")), "utf8"));
	expect(line).toMatchObject({
		v: 1,
		session: "s1",
		type: "session.state",
		data: { state: "running" },
	});
	expect(LOGGED_EVENT).toBe("harness:logged");
});

test("reading resumes where it stopped, and a line still being written waits", () => {
	logEvent(target("s1"), undefined, "session.state", { state: "running" });
	const first = readFrom(logPath(target("s1")), 0);
	expect(first.events).toHaveLength(1);
	appendFileSync(logPath(target("s1")), '{"v":1,"type":"session.state","sess');
	const partial = readFrom(logPath(target("s1")), first.offset);
	expect(partial).toEqual({ events: [], offset: first.offset });
	appendFileSync(
		logPath(target("s1")),
		'ion":"s1","at":5,"id":"x","data":{"state":"idle"}}\nnot json\n',
	);
	const rest = readFrom(logPath(target("s1")), partial.offset);
	expect(rest.events.map((event) => event.data)).toEqual([{ state: "idle" }]);
});

test("a line that lost its payload is not an event, so nothing folds it", () => {
	// The log is written by whichever version was running. An event without `data` would hand
	// `undefined` to whoever folds it, which reads as "nothing changed" and hides the loss.
	logEvent(target("s1"), undefined, "session.state", { state: "running" });
	const start = readFrom(logPath(target("s1")), 0).offset;
	appendFileSync(
		logPath(target("s1")),
		'{"v":1,"type":"session.state","session":"s1","at":5,"id":"x"}\n',
	);
	const read = readFrom(logPath(target("s1")), start);
	expect(read.events.map((event) => event.id)).toEqual([]);
	expect(read.offset).toBeGreaterThan(start);
});

test("a feed reads every session in the folder, oldest first, each event once", () => {
	const feed = new FolderFeed(dir);
	expect(feed.read()).toEqual([]);
	logEvent(target("a"), undefined, "session.state", { state: "running" });
	logEvent(target("b"), undefined, "session.state", { state: "idle" });
	const events = feed.read();
	expect(events.map((event) => event.session)).toEqual(["a", "b"]);
	expect(feed.read()).toEqual([]);
	logEvent(target("a"), undefined, "session.ended", {});
	expect(feed.read().map((event) => event.type)).toEqual(["session.ended"]);
});

test("a folder drops the logs of sessions that are closed and quiet for a week, and keeps the rest", () => {
	mkdirSync(dir, { recursive: true });
	mkdirSync(liveDir(root), { recursive: true });
	const now = Date.now();
	const old = (now - KEEP_LOGS_MS - 1_000) / 1_000;
	for (const session of ["closed", "open", "recent"]) writeFileSync(logPath(target(session)), "");
	utimesSync(logPath(target("closed")), old, old);
	utimesSync(logPath(target("open")), old, old);
	writeFileSync(join(liveDir(root), "open.json"), "{}");

	pruneLogs(dir, root, now);

	expect(existsSync(logPath(target("closed")))).toBe(false);
	expect(existsSync(logPath(target("open")))).toBe(true);
	expect(existsSync(logPath(target("recent")))).toBe(true);
});

test("a feed that wants some types reads only those", () => {
	const bus = { emit: () => {} };
	logEvent(target("s1"), bus, "session.named", { handle: "kestrel" });
	logEvent(target("s1"), bus, "activity", { state: "idle" } as never);
	const read = new FolderFeed(dir, (type) => type === "session.named").read();
	expect(read.map((event) => event.type)).toEqual(["session.named"]);
});

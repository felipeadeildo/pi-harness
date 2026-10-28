import { describe, expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import type { Peer, Posted, RoomItem } from "../src/folder.ts";
import type { Named } from "../src/names.ts";
import { feedMoving, feedView } from "../src/ui/feed.ts";
import { FRESH_MS } from "../src/ui/motion.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

const names = new Map<string, Named>([
	["a", { session: "a", handle: "oauth", color: "syntaxString" } as Named],
	["b", { session: "b", handle: "migration", color: "syntaxType" } as Named],
	["c", { session: "c", handle: "docs", color: "syntaxNumber" } as Named],
]);

function peer(session: string, state: Peer["state"] = "idle"): Peer {
	return {
		session,
		startedAt: 0,
		stateAt: 0,
		state,
		edited: new Map(),
		ran: [],
		commits: [],
	} as unknown as Peer;
}

const live = [peer("a"), peer("b"), peer("c")];

function said(id: string, session: string, to: Posted["to"], text: string, at: number): RoomItem {
	return {
		kind: "message",
		message: {
			id,
			session,
			from: "agent",
			to,
			text,
			urgent: false,
			depth: 0,
			at,
			received: new Map(),
			read: new Set(),
			bids: new Map(),
		},
	};
}

function joined(session: string, at: number): RoomItem {
	return { kind: "happening", happening: { kind: "joined", session, at } };
}

function draw(room: RoomItem[], only?: string): string[] {
	return feedView(room, [], {
		theme: plain,
		now: 1_000_000,
		width: 70,
		me: "c",
		names,
		live,
		clock: () => "12:00",
		only,
	}).lines;
}

describe("the room", () => {
	test("an answer right under its question shows just its words", () => {
		const lines = draw([
			said("1", "a", ["b"], "Are you touching src/auth.ts?", 1_000),
			said("2", "b", ["a"], "Not anymore.", 2_000),
		]);
		const at = lines.findIndex((line) => line.startsWith("@migration → @oauth"));
		expect(lines[at - 1]).toBe("");
		expect(lines[at + 1]).toContain("Not anymore.");
	});

	test("an answer with other messages in between quotes the first line it answers", () => {
		const lines = draw([
			said("1", "a", ["b"], "Are you touching src/auth.ts?", 1_000),
			said("2", "c", ["a"], "Unrelated.", 1_500),
			said("3", "b", ["a"], "Not anymore.", 2_000),
		]);
		const at = lines.findIndex((line) => line.startsWith("@migration → @oauth"));
		expect(lines[at + 1]).toContain("\u21b1 @oauth Are you touching src/auth.ts?");
	});

	test("a long preview skips blank lines and says how many more there are", () => {
		const text = "\nfirst\n\nsecond\n\nthird\nfourth\nfifth";
		const room = [said("1", "a", ["b"], text, 1_000), said("2", "b", ["a"], "ok", 2_000)];
		const lines = draw(room);
		const at = lines.findIndex((line) => line.startsWith("@oauth → @migration"));
		const body = lines.slice(at + 1, at + 5).join("\n");
		expect(body).toContain("first");
		expect(body).toContain("second");
		expect(body).toContain("third");
		expect(body).toContain("2 more lines, ctrl+f to read");
	});

	test("joins close together read as one line, with the time after it", () => {
		expect(draw([joined("a", 0), joined("b", 10), joined("c", 20)])).toEqual([
			"\u2192 oauth, migration and docs joined  12:00",
		]);
	});

	test("what became of a message is the last line under it", () => {
		const room = [said("1", "a", ["b"], "hi", 1_000)];
		const message = room[0]?.kind === "message" ? room[0].message : undefined;
		message?.read.add("b");
		const lines = draw(room);
		expect(lines[0]).toContain("@oauth → @migration");
		expect(lines[0]).toContain("12:00");
		expect(lines.at(-1)).toContain("✓✓ read");
	});

	test("a message that just arrived keeps its rail", () => {
		expect(draw([said("1", "a", ["b"], "hi", 1_000_000 - 1)])[1]).toContain("\u258e");
		expect(draw([said("1", "a", ["b"], "hi", 1_000)])[1]).not.toContain("\u258e");
	});

	test("a long message shows its first lines, unless it is the newest or the room is narrowed", () => {
		const long = Array.from({ length: 8 }, (_, line) => `line ${line}`).join("\n");
		const room = [said("1", "a", ["b"], long, 1_000), said("2", "b", ["a"], "ok", 2_000)];
		const text = draw(room).join("\n");
		expect(text).toContain("line 2");
		expect(text).not.toContain("line 3");
		expect(text).toContain("5 more lines, ctrl+f to read");
		expect(draw(room, "a").join("\n")).toContain("line 7");
		expect(draw([said("1", "a", ["b"], long, 1_000)]).join("\n")).toContain("line 7");
	});

	test("leaving and coming back within a minute reads as a restart", () => {
		const left: RoomItem = { kind: "happening", happening: { kind: "left", session: "a", at: 0 } };
		expect(draw([left, joined("a", 5_000)])).toEqual(["\u21bb oauth restarted  12:00"]);
	});

	test("narrowed to one agent, the room shows only what it wrote or was sent", () => {
		const lines = draw(
			[
				said("1", "a", ["b"], "to migration", 1_000),
				said("2", "c", "all", "to everyone", 2_000),
				said("3", "c", "any", "to anyone", 3_000),
			],
			"b",
		);
		expect(lines.join("\n")).toContain("to migration");
		// Everyone includes it; a request it did not bid on does not.
		expect(lines.join("\n")).toContain("to everyone");
		expect(lines.join("\n")).not.toContain("to anyone");
		expect(draw([], "b")).toEqual(["Nothing from or to migration yet."]);
	});

	test("a message to everyone says how many got it", () => {
		const message = said("1", "c", "all", "deploy at six", 1_000);
		if (message.kind === "message") {
			message.message.received.set("a", { mode: "woke", at: 1_100 });
			message.message.read.add("b");
		}
		const lines = draw([message], undefined);
		const bottom = lines.at(-1) ?? "";
		expect(bottom).toContain("1 read");
		expect(bottom).toContain("1 got it");
		expect(lines.join("\n")).not.toMatch(/[\u256d\u2570]/);
	});

	test("a message moves while it is new or on its way, and stops after", () => {
		const room = [said("1", "a", ["b"], "hi", 1_000)];
		expect(feedMoving(room, live, 1_000 + FRESH_MS - 1)).toBe(true);
		// Not logged by migration yet, so still on its way.
		expect(feedMoving(room, live, 1_000 + FRESH_MS + 1)).toBe(true);
		const message = room[0]?.kind === "message" ? room[0].message : undefined;
		message?.received.set("b", { mode: "woke", at: 1_100 });
		expect(feedMoving(room, live, 1_000 + FRESH_MS + 1)).toBe(false);
	});
});

describe("agents coming and going", () => {
	const left = (session: string, at: number): RoomItem => ({
		kind: "happening",
		happening: { kind: "left", session, at },
	});

	test("a run of joins, leaves and restarts folds into one line that counts them", () => {
		const lines = draw([
			joined("a", 1_000),
			left("b", 100_000),
			left("c", 200_000),
			joined("c", 210_000),
			said("1", "a", "all", "Hello", 300_000),
		]);
		expect(lines).toContain(
			"\u21bb agents came and went: 1 joined, 1 left, 1 restarted  12:00 to 12:00",
		);
		expect(lines.some((line) => line.includes("Hello"))).toBe(true);
	});

	test("a few stay one line each", () => {
		const lines = draw([joined("a", 1_000), said("1", "a", "all", "Hello", 300_000)]);
		expect(lines.some((line) => line.includes("oauth joined"))).toBe(true);
	});

	test("a new day starts under a line that names it", () => {
		const day = 24 * 60 * 60 * 1000;
		const lines = feedView(
			[said("1", "a", "all", "Old", 1_000), said("2", "b", "all", "New", day + 1_000)],
			[],
			{
				theme: plain,
				now: day + 2_000,
				width: 70,
				me: "c",
				names,
				live,
				clock: () => "12:00",
			},
		).lines;
		const marks = lines.filter((line) => /^(Today|Yesterday|\w{3} \d+ \w{3}) \u2500/.test(line));
		expect(marks.map((line) => line.split(" ")[0])).toEqual(["Yesterday", "Today"]);
	});
});

describe("a long room", () => {
	const room = Array.from({ length: 1_000 }, (_, at) =>
		said(String(at), "a", ["b"], `message ${at}`, at),
	);

	test("lays out only the newest items asked for, and says older ones were left out", () => {
		const view = feedView(room, [], {
			theme: plain,
			now: 1_000_000,
			width: 70,
			me: "c",
			names,
			live,
			clock: () => "12:00",
			last: 10,
		});
		const text = view.lines.join("\n");
		expect(text).toContain("message 999");
		expect(text).toContain("message 990");
		expect(text).not.toContain("message 989");
		expect(view.older).toBe(true);
	});
});

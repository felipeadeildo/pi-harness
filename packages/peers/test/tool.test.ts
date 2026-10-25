import { describe, expect, setSystemTime, spyOn, test } from "bun:test";

import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import type { Peer, Posted } from "../src/folder.ts";
import type { SentDetails } from "../src/index.ts";
import type { Named } from "../src/names.ts";
import { BID_WINDOW_MS } from "../src/rules.ts";
import {
	audienceOf,
	callLines,
	type Places,
	resultLines,
	type Source,
	toolRenderers,
} from "../src/ui/tool.ts";

const plain = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

const handles: Record<string, string> = { me: "writer", a: "oauth", b: "migration", c: "docs" };

function peer(session: string): Peer {
	return {
		session,
		handle: handles[session],
		startedAt: 0,
		state: "idle",
		prompted: true,
	} as unknown as Peer;
}

function source(message: Posted, open = ["me", "a", "b", "c"]): Source {
	const live = open.map(peer);
	const names = new Map<string, Named>(
		open.map((session) => [
			session,
			{ session, handle: handles[session], color: "muted" } as unknown as Named,
		]),
	);
	return {
		session: "me",
		folder: {
			messages: new Map([[message.id, message]]),
			peers: new Map(live.map((one) => [one.session, one])),
		},
		live: () => live,
		names: () => ({ bySession: names, aliases: new Map() }),
	} as unknown as Source;
}

function posted(to: Posted["to"], extra: Partial<Posted> = {}): Posted {
	return {
		id: "m1",
		session: "me",
		from: "agent",
		to,
		text: "hi",
		urgent: false,
		depth: 0,
		at: 1_000,
		received: new Map(),
		read: new Set(),
		bids: new Map(),
		...extra,
	};
}

const sent: AgentToolResult<SentDetails> = {
	content: [{ type: "text", text: "Sent." }],
	details: { id: "m1", to: [], text: "hi" },
};

describe("who the call goes to", () => {
	test("reads `to` the way the tool sends it", () => {
		expect(audienceOf(undefined)).toBe("all");
		expect(audienceOf("room")).toBe("all");
		expect(audienceOf("oauth, Anyone")).toBe("any");
		expect(audienceOf("oauth, docs")).toEqual(["oauth", "docs"]);
	});

	test("a group is written as the group, with how many it reaches", () => {
		const here = { here: source(posted("all")), room: undefined };
		const [all] = callLines(here, { action: "send", to: "everyone", text: "x" }, plain, 80, false);
		expect(all).toBe("→ @everyone  3 agents get it");
		const [any] = callLines(here, { action: "send", to: "anyone", text: "x" }, plain, 80, false);
		expect(any).toBe("→ @anyone  3 agents bid, the best fit takes it");
	});

	test("a shared room says so, and a link names the folder", () => {
		const shown = { here: source(posted("all"), ["me", "a"]), room: "backend+frontend" };
		const [all] = callLines(shown, { action: "send", text: "x" }, plain, 80, false);
		expect(all).toBe("→ @everyone  1 agent gets it  in backend+frontend");
		const link = { action: "link", folder: "~/Projects/backend" };
		expect(callLines(shown, link, plain, 80, false)).toEqual([
			"ask to talk to the agents open in ~/Projects/backend",
		]);
	});
});

describe("a message to everyone", () => {
	test("fans out into names, those that read it first, under the count", () => {
		const message = posted("all", {
			received: new Map([
				["a", { mode: "woke", at: 1_100 }],
				["c", { mode: "woke", at: 1_100 }],
			]),
			read: new Set(["c"]),
		});
		const lines = resultLines(source(message), sent, false, plain, 80, 2_000);
		expect(lines).toEqual([
			"✓ 1 of 3 read, 1 got it, 1 on its way",
			"  docs ✓✓   oauth ✓✓   migration ✓",
		]);
	});

	test("lights the group's ticks only when all of them read it", () => {
		const message = posted("all", { read: new Set(["a", "b", "c"]) });
		const [summary] = resultLines(source(message), sent, false, plain, 80, 2_000);
		expect(summary).toBe("✓✓ all 3 read it");
	});

	test("expanded, it gives a line per agent with how it arrived", () => {
		const message = posted("all", { received: new Map([["a", { mode: "steered", at: 1_100 }]]) });
		const lines = resultLines(source(message), sent, true, plain, 80, 2_000);
		expect(lines).toContain("✓✓ oauth cut into its run");
	});

	test("a minute on, one that never logged it stops being on its way", () => {
		const message = posted("all", { received: new Map([["a", { mode: "woke", at: 1_100 }]]) });
		const lines = resultLines(source(message, ["me", "a", "b"]), sent, false, plain, 80, 90_000);
		expect(lines).toEqual(["✓ 0 of 2 read, 1 got it, 1 sent", "  oauth ✓✓   migration ✓"]);
	});
});

describe("a request to anyone", () => {
	test("counts the bids while the window is open, and shows who is still thinking", () => {
		const message = posted("any", {
			bids: new Map([["a", { idle: true, fit: 0.8, reason: "", at: 1_200 }]]),
		});
		const lines = resultLines(source(message), sent, false, plain, 80, 2_000);
		const left = Math.ceil((1_000 + BID_WINDOW_MS - 2_000) / 1_000);
		expect(lines[0]).toBe(`◇ 1 of 3 bid, bids close in ${left}s`);
		expect(lines[1]).toBe("  oauth ▰▰▰▰▱ .80   migration thinking   docs thinking");
	});

	test("once taken, says who took it and drops the busy bids", () => {
		const message = posted("any", {
			takenBy: "a",
			bids: new Map([
				["a", { idle: true, fit: 0.8, reason: "", at: 1_200 }],
				["b", { idle: false, fit: 0.9, reason: "", at: 1_200 }],
			]),
		});
		const lines = resultLines(source(message), sent, false, plain, 80, 20_000);
		expect(lines).toEqual(["✓✓ oauth took it", "  oauth ▰▰▰▰▱ .80"]);
	});
});

describe("where the receipt looks", () => {
	test("a message sent in a shared room is found in that room, not the folder's", () => {
		const message = posted("all", { read: new Set(["a"]) });
		const shared = source(message, ["me", "a"]);
		const empty = source(posted("all", { id: "other" }), ["me"]);
		const places: Places = {
			here: (room) => (room === "r1" ? shared : empty),
			rooms: () => [
				{ id: undefined, name: "pi-harness" },
				{ id: "r1", name: "backend+frontend" },
			],
		};
		const row = { toolCallId: "c1", argsComplete: true, state: {}, invalidate: () => {} };
		const result = { ...sent, details: { ...sent.details, room: "r1" } };
		const [summary] = toolRenderers(places, new Map())
			.renderResult(result, { expanded: false }, plain, row)
			.render(80);
		expect(summary).toBe("✓✓ read it");
	});
});

function nothing(): void {}

describe("a row drawn again and again", () => {
	const places: Places = {
		here: () => source(posted("all", { read: new Set(["a"]) }), ["me", "a"]),
		rooms: () => [{ id: undefined, name: "pi-harness" }],
	};

	/** Draws both halves of one row as pi does on each redraw, handing back what each returned. */
	function redraw(times: number, keep: (first: object) => void) {
		const rows = new Map<string, () => void>();
		const renderers = toolRenderers(places, rows);
		const firsts: Component[] = [];
		const state = {};
		let call: Component | undefined;
		let result: Component | undefined;
		for (let i = 0; i < times; i++) {
			const row = {
				toolCallId: "c1",
				argsComplete: true,
				state,
				invalidate: nothing,
				lastComponent: call,
			};
			call = renderers.renderCall({ to: "@everyone", text: "hi" }, plain, row);
			const resultRow = {
				toolCallId: "c1",
				argsComplete: true,
				state,
				invalidate: nothing,
				lastComponent: result,
			};
			result = renderers.renderResult(sent, { expanded: false }, plain, resultRow);
			call.render(80);
			result.render(80);
			if (i === 0) {
				keep(row);
				keep(resultRow);
				firsts.push(call, result);
			}
		}
		return { call, result, rows, firsts };
	}

	test("keeps the component it drew, updated, instead of a new one each time", () => {
		const renderers = toolRenderers(places, new Map());
		const row = { toolCallId: "c1", argsComplete: false, state: {}, invalidate: () => {} };
		const first = renderers.renderCall({ action: "send", to: "everyone" }, plain, row);
		expect(first.render(80).join("\n")).toContain("@everyone");
		const again = renderers.renderCall({ action: "send", to: "anyone" }, plain, {
			...row,
			argsComplete: true,
			lastComponent: first,
		});
		expect(again).toBe(first);
		expect(again.render(80).join("\n")).toContain("@anyone");

		const result = renderers.renderResult(sent, { expanded: false }, plain, row);
		const expanded = renderers.renderResult(sent, { expanded: true }, plain, {
			...row,
			lastComponent: result,
		});
		expect(expanded).toBe(result);
	});

	test("a receipt on its way asks the clock once for its next redraw, not once per drawing", () => {
		const nowAt = Date.now();
		const moving: Places = {
			here: () => source(posted(["a"], { at: nowAt }), ["me", "a"]),
			rooms: () => [],
		};
		const timers = spyOn(globalThis, "setTimeout");
		try {
			const row = { toolCallId: "c1", argsComplete: true, state: {}, invalidate: nothing };
			const drawn = toolRenderers(moving, new Map()).renderResult(
				sent,
				{ expanded: false },
				plain,
				row,
			);
			for (let i = 0; i < 10; i++) drawn.render(80);
			expect(timers).toHaveBeenCalledTimes(1);
		} finally {
			timers.mockRestore();
		}
	});

	test("keeps one redraw per call, the one of the row pi drew last", () => {
		const rows = new Map<string, () => void>();
		const renderers = toolRenderers(places, rows);
		const drawnBy: string[] = [];
		for (const [call, by] of [
			["c1", "first"],
			["c1", "again"],
			["c2", "other"],
		] as const) {
			const row = {
				toolCallId: call,
				argsComplete: true,
				state: {},
				invalidate: () => drawnBy.push(by),
			};
			renderers.renderResult(sent, { expanded: false }, plain, row);
		}
		for (const again of rows.values()) again();
		expect(drawnBy).toEqual(["again", "other"]);
	});

	test("works its receipts out again only when the room changes, the second turns, or the width", () => {
		const here = source(posted("all", { read: new Set(["a"]) }), ["me", "a"]) as Source & {
			folder: { version: number };
		};
		here.folder.version = 1;
		let asked = 0;
		const live = here.live.bind(here);
		here.live = () => {
			asked++;
			return live();
		};
		const counted: Places = { here: () => here, rooms: () => [] };
		// The clock stands still, so the second does not turn in the middle.
		setSystemTime(new Date(1_000_000));
		const row = { toolCallId: "c1", argsComplete: true, state: {}, invalidate: nothing };
		const drawn = toolRenderers(counted, new Map()).renderResult(
			sent,
			{ expanded: false },
			plain,
			row,
		);
		drawn.render(80);
		const once = asked;
		for (let i = 0; i < 100; i++) drawn.render(80);
		expect(asked).toBe(once);
		here.folder.version++;
		drawn.render(80);
		expect(asked).toBe(once * 2);
		drawn.render(60);
		expect(asked).toBe(once * 3);
		setSystemTime(new Date(1_001_000));
		drawn.render(60);
		expect(asked).toBe(once * 4);
		setSystemTime();
	});

	test("a read that arrives shows in the same second, because the folder that brought it moved on", () => {
		setSystemTime(new Date(1_000_000));
		try {
			const message = posted(["a", "b"]);
			const here = source(message, ["me", "a", "b"]) as Source & { folder: { version: number } };
			here.folder.version = 1;
			const one: Places = { here: () => here, rooms: () => [] };
			const row = { toolCallId: "c1", argsComplete: true, state: {}, invalidate: nothing };
			const drawn = toolRenderers(one, new Map()).renderResult(
				sent,
				{ expanded: false },
				plain,
				row,
			);
			const before = drawn.render(80);
			message.read.add("a");
			here.folder.version++;
			expect(drawn.render(80)).not.toEqual(before);
		} finally {
			setSystemTime();
		}
	});

	test("draws again at once when pi hands it another state, or asks after a theme change", () => {
		setSystemTime(new Date(1_000_000));
		try {
			const all = source(posted("all", { read: new Set(["a"]) }), ["me", "a"]);
			const one: Places = { here: () => all, rooms: () => [] };
			const renderers = toolRenderers(one, new Map());
			const row = { toolCallId: "c1", argsComplete: true, state: {}, invalidate: nothing };
			const drawn = renderers.renderResult(sent, { expanded: false }, plain, row);
			const folded = drawn.render(80);
			const again = { ...row, lastComponent: drawn };
			expect(renderers.renderResult(sent, { expanded: true }, plain, again).render(80)).not.toEqual(
				folded,
			);
			let painted = "";
			const marked = {
				...plain,
				fg: (_color: string, text: string) => `${painted}${text}`,
			} as Theme;
			renderers.renderResult(sent, { expanded: true }, marked, again);
			const before = drawn.render(80);
			// A theme change repaints in place: pi calls invalidate, not renderResult.
			painted = "*";
			drawn.invalidate();
			expect(drawn.render(80)).not.toEqual(before);
		} finally {
			setSystemTime();
		}
	});

	test("a transcript of many calls lets go of every context but the last", () => {
		// pi hands a new context per drawing, and each one holds the component drawn before it. A
		// row drawn once and never again must not keep its context: a day-long transcript would.
		const renderers = toolRenderers(places, new Map());
		const contexts: WeakRef<object>[] = [];
		let last: Component | undefined;
		for (let i = 0; i < 500; i++) {
			// The very context pi keeps referenced, not a copy: the WeakRef has to watch what the
			// renderer was given, or a leak of 500 contexts leaves this test green.
			const row: Record<string, unknown> = {
				toolCallId: `c${i}`,
				argsComplete: true,
				state: {},
				invalidate: nothing,
			};
			contexts.push(new WeakRef(row));
			last = renderers.renderResult(sent, { expanded: false }, plain, row as never);
			last.render(80);
		}
		Bun.gc(true);
		const kept = contexts.filter((ref) => ref.deref() !== undefined);
		// The one still in hand, and nothing else.
		expect(kept.length).toBeLessThanOrEqual(1);
		expect(last?.render(80).length).toBeGreaterThan(0);
	});

	test("lets go of what pi handed the first drawing", () => {
		const first: WeakRef<object>[] = [];
		const { call, result, rows, firsts } = redraw(1_000, (row) => first.push(new WeakRef(row)));
		Bun.gc(true);
		expect(first.map((ref) => ref.deref())).toEqual([undefined, undefined]);
		// The same two components all along, and one redraw for the one call.
		expect([call, result]).toEqual(firsts);
		expect(call).toBe(firsts[0]);
		expect(result).toBe(firsts[1]);
		expect(rows.size).toBe(1);
		// The last components are still in use; they only must not hold the rows before them.
		expect(call?.render(80).length).toBeGreaterThan(0);
		expect(result?.render(80).length).toBeGreaterThan(0);
	});
});

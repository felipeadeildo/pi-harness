import { describe, expect, test } from "bun:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { ViewState, Viewport } from "../src/view/state.ts";

function entry(id: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "t",
		message: { role: "user", content: id, timestamp: 0 },
	} as SessionEntry;
}

describe("what a view holds of its session", () => {
	test("keeps each entry once, in the order the source sends them", () => {
		const state = new ViewState();
		expect(state.apply({ kind: "entry", entry: entry("a") })).toBe(true);
		expect(state.apply({ kind: "entry", entry: entry("b") })).toBe(true);
		expect(state.apply({ kind: "entry", entry: entry("a") })).toBe(false);
		expect(state.entries.map((one) => one.id)).toEqual(["a", "b"]);
		expect(state.last).toBe("b");
	});

	test("a reset drops what it held, and the entries from the start follow", () => {
		const state = new ViewState();
		state.apply({ kind: "entry", entry: entry("a") });
		state.apply({ kind: "reset" });
		state.apply({ kind: "entry", entry: entry("a") });
		expect(state.entries.map((one) => one.id)).toEqual(["a"]);
	});

	test("a source that ends says so once, and the entries stay to read", () => {
		const state = new ViewState();
		state.apply({ kind: "entry", entry: entry("a") });
		const before = state.version;
		expect(state.apply({ kind: "ended" })).toBe(true);
		expect(state.apply({ kind: "ended" })).toBe(false);
		expect(state.ended).toBe(true);
		expect(state.version).toBe(before + 1);
		expect(state.entries).toHaveLength(1);
	});
});

describe("where the reader is", () => {
	test("at the end, it follows what arrives", () => {
		const view = new Viewport();
		expect(view.window(30, 10)).toEqual({ start: 20, end: 30 });
		expect(view.window(35, 10)).toEqual({ start: 25, end: 35 });
		expect(view.following).toBe(true);
	});

	test("scrolled back, the lines it reads stay put as more arrive", () => {
		const view = new Viewport();
		view.window(30, 10);
		view.scroll(-5);
		expect(view.window(30, 10)).toEqual({ start: 15, end: 25 });
		expect(view.window(40, 10)).toEqual({ start: 15, end: 25 });
		expect(view.following).toBe(false);
		view.toEnd();
		expect(view.window(40, 10)).toEqual({ start: 30, end: 40 });
	});

	test("stops at the start and at the end, and a page keeps one line in common", () => {
		const view = new Viewport();
		view.window(30, 10);
		view.toStart();
		expect(view.window(30, 10)).toEqual({ start: 0, end: 10 });
		view.scroll(-3);
		expect(view.window(30, 10)).toEqual({ start: 0, end: 10 });
		view.page(1);
		expect(view.window(30, 10)).toEqual({ start: 9, end: 19 });
		view.scroll(100);
		expect(view.following).toBe(true);
	});

	test("everything that fits is drawn whole", () => {
		const view = new Viewport();
		view.scroll(-4);
		expect(view.window(6, 10)).toEqual({ start: 0, end: 6 });
	});
});

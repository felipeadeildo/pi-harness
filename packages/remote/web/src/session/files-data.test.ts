import { describe, expect, test } from "bun:test";

import { DaemonAnswer } from "@adeildo/pi-remote-protocol/client";

import {
	changesLine,
	crumbsOf,
	filesHref,
	placeOf,
	searchOf,
	sizeText,
	totalsOf,
	whyOf,
} from "./files-data.ts";

describe("the place in the address", () => {
	test("no query is the changes; a folder or a file is the tree", () => {
		expect(placeOf(new URLSearchParams(""))).toEqual({ tab: "changes", path: "" });
		expect(placeOf(new URLSearchParams("tab=tree&path=src/app"))).toEqual({
			tab: "tree",
			path: "src/app",
		});
		// A file opens in the tree, in its own folder, even with no tab named.
		expect(placeOf(new URLSearchParams("file=src/app/a.ts"))).toEqual({
			tab: "tree",
			path: "src/app",
			file: "src/app/a.ts",
		});
	});

	test("a place written and read again is the same place", () => {
		for (const place of [
			{ tab: "changes", path: "" },
			{ tab: "tree", path: "" },
			{ tab: "tree", path: "a b/c" },
			{ tab: "tree", path: "x", file: "x/y.ts" },
		] as const)
			expect(placeOf(new URLSearchParams(searchOf(place)))).toEqual(place);
	});

	test("the machine and the session are encoded, so a name with a slash stays one segment", () => {
		expect(filesHref("my box", "a/b", { tab: "tree", path: "src" })).toBe(
			"/session/my%20box/a%2Fb/files?tab=tree&path=src",
		);
	});
});

test("the crumbs start at the folder's name and lead to each folder on the way", () => {
	expect(crumbsOf("pi-harness", "")).toEqual([{ name: "pi-harness", path: "" }]);
	expect(crumbsOf("pi-harness", "packages/remote")).toEqual([
		{ name: "pi-harness", path: "" },
		{ name: "packages", path: "packages" },
		{ name: "remote", path: "packages/remote" },
	]);
});

test("the totals count only the files that have lines, and a binary one adds nothing", () => {
	expect(
		totalsOf([
			{ path: "a", status: "modified", added: 3, removed: 1 },
			{ path: "b.png", status: "modified" },
			{ path: "c", status: "untracked", added: 2, removed: 0 },
		]),
	).toEqual({ added: 5, removed: 1 });
	expect(totalsOf([])).toEqual({ added: 0, removed: 0 });
});

test("the changes are counted in words, and a cut list says there are more", () => {
	expect(changesLine(0, false)).toBe("No changes since the last commit.");
	expect(changesLine(1, false)).toBe("1 file changed since the last commit");
	expect(changesLine(3, false)).toBe("3 files changed since the last commit");
	expect(changesLine(1000, true)).toBe("1000+ files changed since the last commit");
});

test("sizes read like a file manager's", () => {
	expect(sizeText(0)).toBe("0 B");
	expect(sizeText(1023)).toBe("1023 B");
	expect(sizeText(1536)).toBe("1.5 KB");
	expect(sizeText(200 * 1024)).toBe("200 KB");
	expect(sizeText(3 * 1024 * 1024)).toBe("3.0 MB");
});

describe("why a read failed", () => {
	test("the daemon's own words come first, as a sentence", () => {
		expect(
			whyOf(new DaemonAnswer(404, "the file", "that path leads out of the session's folder"), "x"),
		).toBe("That path leads out of the session's folder.");
	});

	test("a refusal with no words is said by its code, and a lost daemon plainly", () => {
		expect(whyOf(new DaemonAnswer(401, "the file"), "the file")).toBe(
			"Not logged in. Ask pi for a new link with /remote.",
		);
		expect(whyOf(new DaemonAnswer(502, "the file"), "the file")).toBe(
			"The session's machine did not answer.",
		);
		expect(whyOf(new TypeError("fetch failed"), "the changes")).toBe(
			"The daemon could not be reached for the changes.",
		);
	});
});

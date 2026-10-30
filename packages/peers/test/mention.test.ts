import { describe, expect, test } from "bun:test";

import type { AutocompleteProvider } from "@earendil-works/pi-tui";

import { completeMentions, recipientsOf, roomTag, roomTagsIn } from "../src/mention.ts";
import type { Named } from "../src/names.ts";

const probe = { session: "p", handle: "claude-probe", color: "syntaxString" } as Named;
const me = { session: "m", handle: "oauth", color: "syntaxKeyword" } as Named;
const names = new Map([
	[probe.session, probe],
	[me.session, me],
]);

/** Pi's own list: files after an `@`. */
const files: AutocompleteProvider = {
	triggerCharacters: ["@"],
	getSuggestions: async (lines, line, col) => {
		const typed = (lines[line] ?? "").slice(0, col).match(/@\S*$/)?.[0];
		return typed === undefined
			? null
			: { prefix: typed, items: [{ value: "@client.ts", label: "client.ts" }] };
	},
	applyCompletion: (lines, cursorLine, cursorCol) => ({
		lines: lines.with(cursorLine, "file applied"),
		cursorLine,
		cursorCol,
	}),
};

describe("who a message goes to", () => {
	test("the agents it mentions, never you", () => {
		expect(
			recipientsOf({ bySession: names }, "m", "@claude-probe and @oauth, run the tests"),
		).toEqual([probe]);
		expect(recipientsOf({ bySession: names }, "m", "only @oauth here")).toBeUndefined();
	});

	test("everyone, when it says @everyone", () => {
		expect(recipientsOf({ bySession: names }, "m", "@everyone who takes the deploy?")).toBe("all");
		expect(recipientsOf({ bySession: names }, "m", "read @everyone.md")).toBeUndefined();
	});

	test("yours, when the @ is a file", () => {
		expect(
			recipientsOf({ bySession: names }, "m", "read @claude-probe/notes.md and @claude-probe.ts"),
		).toBeUndefined();
	});
});

describe("a room after a #", () => {
	const rooms = [
		{ tag: "pi-harness", description: "this folder's room, 2 open" },
		{ tag: roomTag("API contract"), description: "shared room, 1 open" },
	];
	const signal = new AbortController().signal;

	test("is its name in lower case with dashes, and a trailing period is the sentence's", () => {
		expect(rooms[1]?.tag).toBe("api-contract");
		expect(roomTagsIn("#api-contract @anyone, see #410.")).toEqual(["api-contract", "410"]);
		expect(roomTagsIn("# Heading and a#b and src/#x")).toEqual([]);
	});

	test("lists the rooms, and goes in with a space after it", async () => {
		const provider = completeMentions(
			files,
			() => [probe],
			() => rooms,
		);
		expect(provider.triggerCharacters).toEqual(["@", "#"]);
		const found = await provider.getSuggestions(["#api"], 0, 4, { signal });
		expect(found).toEqual({
			prefix: "#api",
			items: [
				{ value: "#api-contract", label: "#api-contract", description: "shared room, 1 open" },
			],
		});
		const item = found?.items[0] ?? { value: "", label: "" };
		expect(provider.applyCompletion(["#api"], 0, 4, item, "#api")).toEqual({
			lines: ["#api-contract "],
			cursorLine: 0,
			cursorCol: 14,
		});
	});

	test("lists nothing with one room, since there is nothing to choose", async () => {
		const provider = completeMentions(
			files,
			() => [probe],
			() => rooms.slice(0, 1),
		);
		expect(await provider.getSuggestions(["#pi"], 0, 3, { signal })).toBeNull();
	});
});

describe("the list after an @", () => {
	const provider = completeMentions(files, () => [probe]);
	const signal = new AbortController().signal;

	test("shows the agents, everyone and anyone above the files", async () => {
		const found = await provider.getSuggestions(["ask @cl"], 0, 7, { signal });
		expect(found?.prefix).toBe("@cl");
		expect(found?.items.map((item) => item.value)).toEqual(["@claude-probe", "@client.ts"]);
		const all = await provider.getSuggestions(["@"], 0, 1, { signal });
		expect(all?.items.map((item) => item.value)).toEqual([
			"@claude-probe",
			"@everyone",
			"@anyone",
			"@client.ts",
		]);
	});

	test("is pi's alone in a path, or with nobody else here", async () => {
		const path = await provider.getSuggestions(["@src/cl"], 0, 7, { signal });
		expect(path?.items.map((item) => item.value)).toEqual(["@client.ts"]);
		const alone = completeMentions(files, () => []);
		const found = await alone.getSuggestions(["@cl"], 0, 3, { signal });
		expect(found?.items.map((item) => item.value)).toEqual(["@client.ts"]);
	});

	test("an agent goes in with a space after it, a file the way pi puts it", () => {
		const agent = { value: "@claude-probe", label: "@claude-probe" };
		expect(provider.applyCompletion(["ask @cl now"], 0, 7, agent, "@cl")).toEqual({
			lines: ["ask @claude-probe now"],
			cursorLine: 0,
			cursorCol: 18,
		});
		const file = { value: "@client.ts", label: "client.ts" };
		expect(provider.applyCompletion(["@cl"], 0, 3, file, "@cl").lines).toEqual(["file applied"]);
	});
});

import { describe, expect, test } from "bun:test";

import type { SessionCommand } from "@adeildo/pi-remote-protocol";

import {
	insertAt,
	marked,
	matchCommands,
	type Mentionable,
	suggestedAt,
	withCommand,
	wordAt,
} from "./suggestions.ts";

const commands: SessionCommand[] = [
	{ name: "compact", description: "Ask pi to compact", source: "pi" },
	{ name: "skill:deploy", description: "Deploy it", source: "skill" },
	{ name: "review", source: "prompt" },
];
const agents: Mentionable[] = [
	{ handle: "kestrel", name: "Fix the queue", folder: "hedy" },
	{ handle: "locust", folder: "pi-harness" },
];

function offered(text: string, cursor = text.length): string[] {
	return suggestedAt(text, cursor, commands, agents).map((one) => one.value);
}

describe("what the field offers", () => {
	test("a slash at the start offers every command, in the session's order, filtered by what follows", () => {
		expect(offered("/")).toEqual(["/compact", "/skill:deploy", "/review"]);
		expect(offered("/RE")).toEqual(["/review"]);
		expect(offered("/model")).toEqual([]);
	});

	test("a slash inside a sentence offers only skills, which expand anywhere", () => {
		expect(offered("ship it with /")).toEqual(["/skill:deploy"]);
		expect(offered("ship it with /skill:d")).toEqual(["/skill:deploy"]);
	});

	test("an @ offers the agents and the two group mentions, by handle", () => {
		expect(offered("ask @")).toEqual(["@kestrel", "@locust", "@everyone", "@anyone"]);
		expect(offered("ask @lo")).toEqual(["@locust"]);
		expect(suggestedAt("@k", 2, commands, agents)[0]?.description).toBe("Fix the queue, hedy");
	});

	test("a word already ended, or a path, offers nothing", () => {
		expect(offered("/compact ")).toEqual([]);
		expect(offered("read src/a.ts")).toEqual([]);
		expect(wordAt("mail me@host", 12)).toBeUndefined();
	});

	test("choosing one replaces the word at the cursor and leaves a space after it", () => {
		expect(insertAt("ask @lo now", 7, "@locust")).toEqual({ text: "ask @locust now", cursor: 12 });
		expect(insertAt("/re", 3, "/review")).toEqual({ text: "/review ", cursor: 8 });
	});
});

describe("what the field paints", () => {
	test("commands the session offers and agents it knows, and nothing else", () => {
		expect(marked("/review this, @kestrel and @nobody /nope", commands, agents)).toEqual([
			{ text: "/review", mark: true },
			{ text: " this, ", mark: false },
			{ text: "@kestrel", mark: true },
			{ text: " and @nobody /nope", mark: false },
		]);
	});
});

describe("a command picked from the list", () => {
	test("goes before what was written, and the cursor waits at the end", () => {
		expect(withCommand("", "review")).toEqual({ text: "/review ", cursor: 8 });
		expect(withCommand("  the queue", "skill:deploy")).toEqual({
			text: "/skill:deploy the queue",
			cursor: 23,
		});
	});

	test("is found by its name or its description, with or without the slash", () => {
		expect(matchCommands(commands, "/dep").map((one) => one.name)).toEqual(["skill:deploy"]);
		expect(matchCommands(commands, "compact").map((one) => one.name)).toEqual(["compact"]);
		expect(matchCommands(commands, "ask pi").map((one) => one.name)).toEqual(["compact"]);
		expect(matchCommands(commands, " ")).toHaveLength(3);
	});
});

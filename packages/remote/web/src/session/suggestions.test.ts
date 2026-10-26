import { describe, expect, test } from "bun:test";

import type { SessionCommand } from "@adeildo/pi-remote-protocol";

import { chosen, suggested, typingCommand } from "./suggestions.ts";

const commands: SessionCommand[] = [
	{ name: "compact", description: "Ask pi to compact", source: "pi" },
	{ name: "skill:deploy", description: "Deploy it", source: "skill" },
	{ name: "review", source: "prompt" },
];

describe("the commands offered while typing", () => {
	test("a draft with no slash offers nothing, and neither does a prompt with the slash inside", () => {
		expect(suggested("ship it", commands)).toEqual([]);
		expect(suggested("/compact please", commands)).toEqual([]);
	});

	test("the prefix filters, and the host's order is kept", () => {
		expect(suggested("/", commands).map((one) => one.name)).toEqual([
			"/compact",
			"/skill:deploy",
			"/review",
		]);
		expect(suggested("/re", commands).map((one) => one.name)).toEqual(["/review"]);
		expect(suggested("/RE", commands).map((one) => one.name)).toEqual(["/review"]);
	});

	test("a command the session does not offer never appears", () => {
		// The list is the host's: a name it does not carry is refused when it is sent, so the field must
		// not promise it either.
		expect(suggested("/model", commands)).toEqual([]);
	});

	test("each suggestion carries the group it belongs to, so the list can title them", () => {
		expect(suggested("/", commands).map((one) => one.source)).toEqual(["pi", "skill", "prompt"]);
	});

	test("choosing one writes the command and leaves the person typing the instruction", () => {
		expect(chosen("/compact")).toBe("/compact ");
		expect(typingCommand("/compact ")).toBe(false);
	});
});

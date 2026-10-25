import { describe, expect, test } from "bun:test";

import { commandsFor, compactInstructions, slashOf } from "../src/bridge/slash.ts";

const offered = commandsFor([
	{ name: "skill:deploy", description: "Deploy it", source: "skill" },
	{ name: "review", description: "Review the branch", source: "prompt" },
	{ name: "deploy", description: "An extension command", source: "extension" },
]);

describe("what a phone may run", () => {
	test("the list a client sees leaves out what only the terminal may run", () => {
		expect(offered.map((one) => one.name)).toEqual(["skill:deploy", "review", "compact"]);
		expect(offered.find((one) => one.name === "deploy")).toBeUndefined();
		expect(offered.at(-1)).toMatchObject({ name: "compact", source: "pi" });
	});

	test("a prompt is a prompt, and a slash command is read against the offered list", () => {
		expect(slashOf("ship it", offered)).toBe("expand");
		expect(slashOf("/review", offered)).toBe("expand");
		expect(slashOf("/skill:deploy now", offered)).toBe("expand");
		// Not offered: refused, so it never reaches the model as the words "/deploy".
		expect(slashOf("/deploy", offered)).toBe("refused");
		expect(slashOf("/model", offered)).toBe("refused");
	});

	test("compact goes to the one effect, with the instruction beside it", () => {
		expect(slashOf("/compact", offered)).toBe("compact");
		expect(compactInstructions("/compact")).toBeUndefined();
		expect(compactInstructions("/compact keep the tests")).toBe("keep the tests");
		expect(compactInstructions("/compact   ")).toBeUndefined();
	});
});

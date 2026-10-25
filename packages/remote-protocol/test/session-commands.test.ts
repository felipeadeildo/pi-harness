import { describe, expect, test } from "bun:test";

import { applyEvent, emptySessionState } from "../src/reduce/state.ts";

describe("what a client may run by typing a slash", () => {
	test("the live event carries the host's list, and one that says nothing keeps it", () => {
		const listed = applyEvent(emptySessionState(), "session.live", {
			name: "rig",
			commands: [
				{ name: "compact", source: "pi", description: "Ask pi to compact" },
				{ name: "skill:deploy", source: "skill" },
			],
		});
		expect(listed.commands?.map((one) => one.name)).toEqual(["compact", "skill:deploy"]);
		expect(listed.name).toBe("rig");

		// A later live event that says only the name must not empty the list: absence is "not said here".
		const again = applyEvent(listed, "session.live", { name: "rig again" });
		expect(again.commands).toEqual(listed.commands);
		expect(again.name).toBe("rig again");
	});

	test("a list this version cannot read does not become the state", async () => {
		// The composer groups by `source`, and the wire decides by it: a value neither knows would be
		// drawn by the screen and misjudged by the refusal.
		const { isFact } = await import("../src/facts.ts");
		expect(isFact("session.live", { kind: "terminal", commands: [{ name: 7 }] })).toBe(false);
		expect(
			isFact("session.live", { kind: "terminal", commands: [{ name: "x", source: "other" }] }),
		).toBe(false);
		expect(
			isFact("session.live", { kind: "terminal", commands: [{ name: "x", source: "skill" }] }),
		).toBe(true);
		expect(isFact("session.live", { kind: "terminal" })).toBe(true);
	});
});

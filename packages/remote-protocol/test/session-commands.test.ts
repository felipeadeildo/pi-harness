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
});

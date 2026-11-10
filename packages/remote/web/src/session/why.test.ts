import { describe, expect, test } from "bun:test";

import { DaemonAnswer } from "@adeildo/pi-remote-protocol/client";

import { whyOf } from "./why.ts";

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
			"That machine did not answer.",
		);
		expect(whyOf(new TypeError("fetch failed"), "the changes")).toBe(
			"The daemon could not be reached for the changes.",
		);
	});
});

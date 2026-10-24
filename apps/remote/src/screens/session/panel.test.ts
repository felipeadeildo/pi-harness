// The panel that holds the question is measured as it renders, and these pin the rule the
// measurement follows. The height itself comes from the device, so the first frame is the run on a
// phone; what is proved here is what the panel promises when a question is swapped for another.
// open, which is the half a thumb notices. The height itself comes from the device, so what is
// proven here is the rule the measurement follows; the first frame is the run on a phone.
import { describe, expect, test } from "bun:test";

import { cap } from "./panel.ts";

describe("the panel that holds a question", () => {
	test("a shorter question does not move what is under the panel", () => {
		expect(cap(240, 120)).toBe(240);
	});

	test("a taller question is shown whole, so the panel grows to it", () => {
		expect(cap(120, 240)).toBe(240);
	});

	test("the first measurement is the content's own, so nothing is reserved before it", () => {
		expect(cap(0, 180)).toBe(180);
	});
});

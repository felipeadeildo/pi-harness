import { expect, test } from "bun:test";

import { LOOK_SETTINGS } from "../src/settings.ts";

// The names createScreen builds its slot record with, so a new slot that nobody declared fails here
// instead of crashing a session.
const SLOTS = ["strip", "topLeft", "topRight", "bottomLeft", "bottomRight", "below", "belowRight"];

test("every slot the screen draws is a declared setting", () => {
	const ids = new Set(LOOK_SETTINGS.map((entry) => entry.id));
	for (const slot of SLOTS) {
		const id =
			slot.startsWith("top") || slot.startsWith("bottom") ? `look.frame.${slot}` : `look.${slot}`;
		expect(ids).toContain(id);
	}
});

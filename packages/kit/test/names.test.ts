import { expect, test } from "bun:test";

import { problemWith } from "../../../scripts/names/check.ts";
import { WORDS } from "../src/names/words.ts";

test("the word list holds every rule the script settled", () => {
	expect(problemWith(WORDS)).toBeUndefined();
});

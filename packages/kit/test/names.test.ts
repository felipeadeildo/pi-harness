import { expect, test } from "bun:test";

import { problemWith } from "../src/names/rules.ts";
import { WORDS } from "../src/names/words.ts";

test("the word list holds every rule the script settled", () => {
	expect(problemWith(WORDS)).toBeUndefined();
});

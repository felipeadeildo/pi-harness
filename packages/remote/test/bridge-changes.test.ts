import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { isStateChangeType } from "@adeildo/pi-remote-protocol";

import { PRODUCERS } from "../src/bridge/producers.ts";

/** Read from the source, so the event list, the fold list and the allowlist cannot drift. */
const dir = new URL("../src/bridge/", import.meta.url);
const source = readdirSync(dir)
	.filter((name) => name.endsWith(".ts"))
	.map((name) => readFileSync(new URL(name, dir), "utf8"))
	.join("\n");

const emitted = [...source.matchAll(/connection\.event\("([a-z.]+)"/g)].flatMap((match) =>
	match[1] === undefined ? [] : [match[1]],
);

const folded = new Set(
	[...source.matchAll(/saw\("([a-z.]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
);

/** Each names the producer that rebuilds it for the opening, so a stale entry fails when the producer goes. */
const REBUILT: Readonly<Record<string, string>> = {
	"cost.changed": "cost",
	"session.live": "model",
};

describe("what the bridge sends", () => {
	test("every state change either folds or has a producer that rebuilds it for the opening", () => {
		const unfolded = emitted
			.filter((type) => isStateChangeType(type))
			.filter((type) => !folded.has(type) && !Object.hasOwn(REBUILT, type));

		expect(unfolded).toEqual([]);
	});

	test("a state change is rebuilt or folded, never both", () => {
		const both = Object.keys(REBUILT).filter((type) => folded.has(type));

		expect(both).toEqual([]);
	});

	test("every rebuilt change names a producer that exists, and the whole list is a state change", () => {
		const fields = PRODUCERS.map((producer) => producer.field);
		const missing = Object.entries(REBUILT)
			.filter(([, field]) => !fields.includes(field as (typeof fields)[number]))
			.map(([type]) => type);
		const stale = Object.keys(REBUILT).filter((type) => !isStateChangeType(type));

		expect({ missing, stale }).toEqual({ missing: [], stale: [] });
	});
});

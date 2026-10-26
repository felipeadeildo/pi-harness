import { describe, expect, test } from "bun:test";

import { speedOf } from "./speed.ts";

const answer = (output: number, durationMs: number) => ({
	type: "message",
	message: { role: "assistant", usage: { output }, durationMs },
});
const prompt = { type: "message", message: { role: "user", content: "go" } };

describe("how fast the model writes", () => {
	test("the last answer's speed, and the recent one weighted by length", () => {
		const speed = speedOf([prompt, answer(100, 4000), prompt, answer(300, 4000)]);
		expect(speed).toEqual({ last: 75, recent: 50, answers: 2 });
	});

	test("an answer pi did not time, or that wrote nothing, says nothing", () => {
		expect(speedOf([prompt, answer(0, 2000), answer(50, 0)])).toBeUndefined();
		expect(
			speedOf([answer(40, 1000), { message: { role: "assistant", usage: { output: 9 } } }]),
		).toEqual({ last: 40, recent: 40, answers: 1 });
	});
});

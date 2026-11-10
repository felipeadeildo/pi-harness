import { describe, expect, test } from "bun:test";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import { provideSessionStart, type StartRequest, startSession } from "../src/contracts/starts.ts";

describe("starting a session from another piece", () => {
	test("with nobody providing it, there is no answer", () => {
		expect(startSession(createEventBus(), { folder: "/work" })).toBeUndefined();
	});

	test("the provider gets the request, and the first provider's answer is the one", async () => {
		const bus = createEventBus();
		const seen: StartRequest[] = [];
		provideSessionStart(bus, async (request) => {
			seen.push(request);
			return { machine: "laptop", session: "s1" };
		});
		provideSessionStart(bus, async () => ({ reason: "a second provider never answers" }));
		const request = { folder: "~/work", prompt: "read the README", machine: "laptop" };
		expect(await startSession(bus, request)).toEqual({ machine: "laptop", session: "s1" });
		expect(seen).toEqual([request]);
	});

	test("a provider that stopped answers nothing more", () => {
		const bus = createEventBus();
		const stop = provideSessionStart(bus, async () => ({ reason: "no" }));
		stop();
		expect(startSession(bus, { folder: "/work" })).toBeUndefined();
	});
});

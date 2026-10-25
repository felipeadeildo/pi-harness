// The names a room uses, including the ones a session used to have: a mention written before a rename
// still reaches the session it meant, unless a live session holds that word now.
import { describe, expect, test } from "bun:test";

import type { Peer } from "../src/folder.ts";
import { byHandle, namesOf } from "../src/names.ts";

function peer(session: string, handle: string | undefined, rest: Partial<Peer> = {}): Peer {
	return {
		session,
		handle,
		startedAt: 1,
		state: "idle",
		stateAt: 1,
		edited: new Map(),
		ran: [],
		commits: [],
		...rest,
	};
}

describe("a word a session used to have", () => {
	test("reaches it, and the new word does too", () => {
		const names = namesOf([peer("s1", "auth", { aliases: ["oauth"] })]);
		expect(byHandle(names, "@oauth")?.handle).toBe("auth");
		expect(byHandle(names, "auth")?.handle).toBe("auth");
	});

	test("is not handed to a second session while the first one is live", () => {
		// The older session keeps the word it has; the alias does not take a live session's name away.
		const names = namesOf([
			peer("s1", "auth", { aliases: ["oauth"] }),
			peer("s2", "oauth", { startedAt: 2 }),
		]);
		expect(names.bySession.get("s2")?.handle).toBe("oauth");
		expect(names.bySession.get("s1")?.handle).toBe("auth");
	});
});

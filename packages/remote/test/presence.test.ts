import { describe, expect, test } from "bun:test";

import { Presence, type PresenceOf } from "../src/daemon/presence.ts";

const PHONE = { kind: "client", name: "phone", machine: "laptop" } as const;
const TAB = { kind: "client", name: "laptop", machine: "laptop" } as const;
const OTTER = { kind: "terminal", name: "otter", machine: "here" } as const;

/** A presence that records what it announced, which is what a client would be sent. */
function watched() {
	const presence = new Presence();
	const said: { session: string; presence: PresenceOf }[] = [];
	presence.onChange((session, one) => said.push({ session, presence: one }));
	return { presence, said };
}

describe("who has a session open", () => {
	test("names the clients that said who they are, and leaves out the ones that did not", () => {
		const { presence } = watched();
		presence.watch("s1", "c1");
		presence.input("s1", "c1", PHONE);
		presence.watch("s1", "c2");
		expect(presence.of("s1")).toEqual({
			viewers: [{ name: "phone", machine: "laptop" }],
			active: PHONE,
		});
	});

	test("two tabs with the same name are one viewer, and the last to type has the mark", () => {
		const { presence } = watched();
		presence.watch("s1", "c1");
		presence.input("s1", "c1", PHONE);
		presence.watch("s1", "c2");
		presence.input("s1", "c2", PHONE);
		expect(presence.of("s1")).toEqual({
			viewers: [{ name: "phone", machine: "laptop" }],
			active: PHONE,
		});
	});

	test("the mark moves with the input, and the same client twice says nothing new", () => {
		const { presence, said } = watched();
		presence.watch("s1", "phone");
		presence.input("s1", "phone", PHONE);
		presence.watch("s1", "laptop");
		presence.input("s1", "laptop", TAB);
		expect(presence.of("s1").active).toEqual(TAB);
		const after = said.length;
		presence.input("s1", "laptop", TAB);
		expect(said).toHaveLength(after);
	});

	test("a session's terminal is a viewer once someone typed there, and a key takes the mark back", () => {
		const { presence } = watched();
		presence.watch("s1", "phone");
		presence.input("s1", "phone", PHONE);
		expect(presence.of("s1").active).toEqual(PHONE);
		presence.typed("s1", OTTER);
		expect(presence.of("s1")).toEqual({
			viewers: [
				{ name: "otter", machine: "here" },
				{ name: "phone", machine: "laptop" },
			],
			active: OTTER,
		});
		presence.input("s1", "phone", PHONE);
		expect(presence.of("s1").active).toEqual(PHONE);
	});

	test("a connection that leaves takes its name, and leaves no mark pointing at nothing", () => {
		const { presence, said } = watched();
		const at = () => said.length;
		presence.watch("s1", "phone");
		presence.input("s1", "phone", PHONE);
		presence.watch("s1", "laptop");
		presence.input("s1", "laptop", TAB);
		const before = at();
		presence.leave("s1", "laptop");
		expect(presence.of("s1")).toEqual({ viewers: [{ name: "phone", machine: "laptop" }] });
		// And it is announced: a client still drawing "laptop is typing" would be wrong from here on.
		expect(said.length).toBeGreaterThan(before);
		expect(said.at(-1)?.presence).toEqual({ viewers: [{ name: "phone", machine: "laptop" }] });
	});

	test("a name a connection also took in another session is not dropped while it watches that one", () => {
		const { presence } = watched();
		presence.watch("s1", "phone");
		presence.input("s1", "phone", PHONE);
		presence.watch("s2", "phone");
		presence.input("s2", "phone", PHONE);
		presence.leave("s1", "phone");
		expect(presence.of("s1")).toEqual({ viewers: [] });
		expect(presence.of("s2").active).toEqual(PHONE);
	});

	test("a session that ends forgets its viewers, its mark and its terminal", () => {
		const { presence } = watched();
		presence.watch("s1", "phone");
		presence.input("s1", "phone", PHONE);
		presence.typed("s1", OTTER);
		presence.forget("s1");
		expect(presence.of("s1")).toEqual({ viewers: [] });
		// A relaunch with the same id starts clean, and the connection that came back names itself.
		presence.watch("s1", "phone");
		expect(presence.of("s1")).toEqual({ viewers: [] });
		presence.input("s1", "phone", PHONE);
		expect(presence.of("s1")).toEqual({
			viewers: [{ name: "phone", machine: "laptop" }],
			active: PHONE,
		});
	});

	test("says who is watching each session, which is what the daemon reports", () => {
		const { presence } = watched();
		presence.watch("s1", "a");
		presence.watch("s1", "b");
		presence.watch("s2", "c");
		expect(presence.counts()).toEqual(
			new Map([
				["s1", 2],
				["s2", 1],
			]),
		);
		expect(presence.connections("s1")).toEqual(["a", "b"]);
	});
});

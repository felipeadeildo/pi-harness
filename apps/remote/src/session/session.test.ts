// The browser's half of a session: the socket a client talks through, and the store a reload draws
// from. Each test holds one promise the route depends on, with fakes for the browser's pieces.
import { describe, expect, test } from "bun:test";

import { connect, memoryCache, type CachedSession } from "@adeildo/pi-remote-client";

import { storageCache, type StorageLike } from "./cache.ts";
import { openSocket, type SocketLike, socketUrl } from "./transport.ts";

class FakeSocket implements SocketLike {
	static made: FakeSocket[] = [];
	readyState = 0;
	sent: string[] = [];
	closed = false;
	readonly #listeners = new Map<string, ((event: { data: unknown }) => void)[]>();

	constructor(readonly url: string) {
		FakeSocket.made.push(this);
	}

	addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
		this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
	}

	#fire(type: string, data?: unknown): void {
		for (const listener of this.#listeners.get(type) ?? []) listener({ data });
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
		this.#fire("close");
	}

	/** The daemon accepts. */
	open(): void {
		this.readyState = 1;
		this.#fire("open");
	}

	/** The daemon sends a line. */
	say(data: unknown): void {
		this.#fire("message", data);
	}

	/** The daemon goes away. */
	drop(): void {
		this.readyState = 3;
		this.#fire("close");
	}
}

function make(url: string): FakeSocket {
	return new FakeSocket(url);
}

describe("the socket", () => {
	test("is the daemon's /ws on the page's own origin", () => {
		expect(socketUrl({ protocol: "http:", host: "127.0.0.1:7878" })).toBe("ws://127.0.0.1:7878/ws");
		expect(socketUrl({ protocol: "https:", host: "pi.example" })).toBe("wss://pi.example/ws");
	});

	test("holds what is sent before it opens, then sends it in order", () => {
		const transport = openSocket("ws://x/ws", make)(
			() => {},
			() => {},
		);
		const socket = FakeSocket.made.at(-1);
		transport.send({ v: 1, kind: "hello", type: "hello", data: {}, at: 0 });
		expect(socket?.sent).toEqual([]);
		socket?.open();
		expect(socket?.sent.map((text) => JSON.parse(text).kind)).toEqual(["hello"]);
	});

	test("hands on what reads as JSON and skips what does not", () => {
		const got: unknown[] = [];
		openSocket("ws://x/ws", make)(
			(value) => got.push(value),
			() => {},
		);
		const socket = FakeSocket.made.at(-1);
		socket?.say("not json");
		socket?.say('{"kind":"event"}');
		expect(got).toEqual([{ kind: "event" }]);
	});

	test("tells a close the daemon made, and keeps quiet about one the client asked for", () => {
		let told = 0;
		const open = openSocket("ws://x/ws", make);
		open(
			() => {},
			() => told++,
		);
		FakeSocket.made.at(-1)?.drop();
		expect(told).toBe(1);
		const asked = open(
			() => {},
			() => told++,
		);
		asked.close();
		expect(told).toBe(1);
	});

	test("lets the client say hello, read the snapshot and draw it", async () => {
		const client = connect({
			key: { machine: "box", session: "s1" },
			cache: memoryCache(),
			open: openSocket("ws://x/ws", make),
		});
		await client.load();
		const socket = FakeSocket.made.at(-1);
		socket?.open();
		expect(JSON.parse(socket?.sent[0] ?? "{}")).toMatchObject({ kind: "hello", session: "s1" });
		const entry = {
			id: "a",
			parentId: null,
			type: "message",
			message: { role: "user", content: "hi" },
		};
		const snapshot = {
			v: 1,
			kind: "event",
			machine: "box",
			session: "s1",
			epoch: "e1",
			seq: 1,
			type: "snapshot",
			data: {
				snapshot: { session: "s1", machine: "box", cwd: "/", kind: "terminal" },
				entries: [entry],
			},
			at: 0,
		};
		socket?.say(JSON.stringify(snapshot));
		expect(client.session().entries).toHaveLength(1);
		client.stop();
		expect(socket?.closed).toBe(true);
	});
});

class FakeStorage implements StorageLike {
	readonly items = new Map<string, string>();
	full = false;
	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		if (this.full) throw new Error("QuotaExceededError");
		this.items.set(key, value);
	}
	removeItem(key: string): void {
		this.items.delete(key);
	}
}

describe("the store", () => {
	const key = { machine: "box", session: "s1" };
	const held: CachedSession = {
		key,
		cursor: { epoch: "e1", seq: 3 },
		entries: [],
		facts: [],
		leaf: "a",
	};

	test("gives back what it kept, per session", async () => {
		const cache = storageCache(new FakeStorage());
		await cache.write(held);
		expect(await cache.read(key)).toEqual(held);
		expect(await cache.read({ machine: "box", session: "other" })).toBeUndefined();
		await cache.drop(key);
		expect(await cache.read(key)).toBeUndefined();
	});

	test("reads an item it cannot parse as a cold open", async () => {
		const storage = new FakeStorage();
		storage.items.set("pi-remote:session:box\ns1", "{broken");
		expect(await storageCache(storage).read(key)).toBeUndefined();
		storage.items.set("pi-remote:session:box\ns1", '{"key":{}}');
		expect(await storageCache(storage).read(key)).toBeUndefined();
	});

	test("keeps the page working when the store is full", async () => {
		const storage = new FakeStorage();
		storage.full = true;
		await storageCache(storage).write(held);
		expect(storage.items.size).toBe(0);
	});
});

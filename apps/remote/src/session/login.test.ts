// The login a link carries: the token stays out of the address it came in on, the cookie is asked
// for, and only an accepted login lets the socket open. Each test drives the exchange by hand.
import { afterEach, describe, expect, test } from "bun:test";

import { memoryCache } from "@adeildo/pi-remote-client";

import {
	type Exchange,
	fetchLogin,
	logIn,
	tokenOf,
	withoutFragment,
	withoutToken,
} from "./login.ts";

function exchange(answer: { ok: boolean; status: number }): Exchange & { asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		async login(token) {
			asked.push(token);
			return answer;
		},
	};
}

function at(hash: string) {
	const replaced: string[] = [];
	return {
		replaced,
		pathname: "/session/box/s1",
		search: "?x=1",
		hash,
		replaceState: (url: string) => void replaced.push(url),
	};
}

describe("the token in a link", () => {
	test("reads from the fragment, and never from a parameter the server sees", () => {
		expect(tokenOf("#token=abc")).toBe("abc");
		expect(tokenOf("#other=1&token=abc")).toBe("abc");
		expect(tokenOf("#token=")).toBeUndefined();
		expect(tokenOf("")).toBeUndefined();
	});

	test("leaves the address without touching the path or the query", () => {
		expect(withoutToken(at("#token=abc"))).toBe("/session/box/s1?x=1");
	});

	test("a URL for the outside world loses the fragment and keeps the query", () => {
		expect(withoutFragment("https://h/a?x=1#token=t")).toBe("https://h/a?x=1");
		expect(withoutFragment("https://h/a?since=7&limit=2")).toBe("https://h/a?since=7&limit=2");
		expect(withoutFragment("https://h/a")).toBe("https://h/a");
	});
});

describe("logging in", () => {
	test("spends the token once, after taking it out of the address", async () => {
		const cache = memoryCache();
		const order: string[] = [];
		const asking: Exchange = {
			async login(token) {
				order.push(`login ${token}`);
				return { ok: true, status: 204 };
			},
		};
		const location = at("#token=abc");
		location.replaceState = (url: string) => void (order.push(`replace ${url}`), url);
		const logged = await logIn(location, { exchange: asking, cache });
		// One list, so the order is what the test checks: the address is clean before the request.
		expect(order).toEqual(["replace /session/box/s1?x=1", "login abc"]);
		expect(logged.ok).toBe(true);
		expect(logged.cache).toBe(cache);
		expect(logged.why).toBeUndefined();
	});

	test("a request that never lands says so, after the token left the address", async () => {
		const location = at("#token=abc");
		const logged = await logIn(location, {
			exchange: {
				async login() {
					throw new Error("fetch failed");
				},
			},
			cache: memoryCache(),
		});
		expect(location.replaced).toEqual(["/session/box/s1?x=1"]);
		expect(logged.ok).toBe(false);
		expect(logged.why).toContain("could not be reached");
	});

	test("a page without a token opens straight away, and asks nothing", async () => {
		const asking = exchange({ ok: true, status: 204 });
		const cache = memoryCache();
		const logged = await logIn(at(""), { exchange: asking, cache });
		expect(asking.asked).toEqual([]);
		expect(logged).toMatchObject({ ok: true, cache });
	});

	test("a spent or late token says so, and a broken answer says something else", async () => {
		const spent = await logIn(at("#token=abc"), {
			exchange: exchange({ ok: false, status: 401 }),
			cache: memoryCache(),
		});
		expect(spent.ok).toBe(false);
		expect(spent.why).toContain("used or has expired");
		const broken = await logIn(at("#token=abc"), {
			exchange: exchange({ ok: false, status: 500 }),
			cache: memoryCache(),
		});
		expect(broken.ok).toBe(false);
		expect(broken.why).toContain("500");
	});

	test("a refused login leaves no cache to draw a session from", async () => {
		const cache = memoryCache();
		const logged = await logIn(at("#token=abc"), {
			exchange: exchange({ ok: false, status: 401 }),
			cache,
		});
		expect(logged.cache).not.toBe(cache);
		expect(await logged.cache.read({ machine: "box", session: "s1" })).toBeUndefined();
	});
});

describe("the request itself", () => {
	const real = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = real;
	});

	/** Runs `fetchLogin` against a fake `fetch`, and hands back what the request was. */
	async function asked(): Promise<{ url: string; init: RequestInit | undefined }> {
		const seen: { url: string; init: RequestInit | undefined }[] = [];
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			seen.push({ url, init });
			return new Response(null, { status: 204 });
		}) as typeof fetch;
		expect(await fetchLogin.login("abc")).toEqual({ ok: true, status: 204 });
		const [call] = seen;
		return call ?? { url: "", init: undefined };
	}

	test("posts the token in the body, on the page's origin, with the cookie made explicit", async () => {
		const call = await asked();
		expect(call.url).toBe("/login");
		expect(call.init?.method).toBe("POST");
		expect(call.init?.credentials).toBe("same-origin");
		expect(call.init?.headers).toEqual({ "content-type": "application/json" });
		expect(call.init?.body).toBe(JSON.stringify({ token: "abc" }));
	});

	test("says it answers JSON when it fails too, so a refusal reads as one", async () => {
		globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
		expect(await fetchLogin.login("abc")).toEqual({ ok: false, status: 401 });
	});
});

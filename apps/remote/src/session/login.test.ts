// The login a link carries: the token stays out of the address it came in on, the cookie is asked
// for, and only an accepted login lets the socket open. Each test drives the exchange by hand.
import { describe, expect, test } from "bun:test";

import { memoryCache } from "@adeildo/pi-remote-client";

import { type Exchange, logIn, tokenOf, withoutToken } from "./login.ts";

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
});

describe("logging in", () => {
	test("spends the token once, after taking it out of the address", async () => {
		const cache = memoryCache();
		const asking = exchange({ ok: true, status: 204 });
		const location = at("#token=abc");
		const logged = await logIn(location, { exchange: asking, cache });
		expect(asking.asked).toEqual(["abc"]);
		expect(location.replaced).toEqual(["/session/box/s1?x=1"]);
		expect(logged.ok).toBe(true);
		expect(logged.cache).toBe(cache);
		expect(logged.why).toBeUndefined();
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

import { describe, expect, test } from "bun:test";

import { parseLink } from "./link-parse.ts";

describe("the address a link names", () => {
	test("a deep link carries the daemon's address and the login token", () => {
		expect(
			parseLink({
				scheme: "piremote",
				hostname: "10.0.0.5:7878",
				path: "/",
				queryParams: { token: "abc" },
			}),
		).toEqual({
			protocol: "piremote",
			host: "10.0.0.5:7878",
			pathname: "/",
			search: "",
			hash: "#token=abc",
		});
	});

	test("a link without an address is refused instead of guessed", () => {
		expect(
			parseLink({ scheme: "piremote", hostname: null, path: "/session", queryParams: {} }),
		).toBeUndefined();
		expect(
			parseLink({ scheme: "piremote", hostname: "", path: "/", queryParams: {} }),
		).toBeUndefined();
	});
});

import { describe, expect, test } from "bun:test";

import { parseLink } from "./link-parse.ts";

describe("the address a link names", () => {
	test("the daemon's own link keeps the port and the token", () => {
		// The link the daemon prints, read whole: the parser of the platform would drop both the port
		// (it takes `URL.hostname`) and the fragment (it reads `searchParams`).
		expect(parseLink("http://10.0.0.5:7878/#token=abc")).toEqual({
			protocol: "http",
			host: "10.0.0.5:7878",
			pathname: "/",
			search: "",
			hash: "#token=abc",
		});
	});

	test("the scheme of a deep link is kept, so the app can tell one of its own links", () => {
		expect(parseLink("piremote://box.local:7878/session?x=1#token=t")).toEqual({
			protocol: "piremote",
			host: "box.local:7878",
			pathname: "/session",
			search: "?x=1",
			hash: "#token=t",
		});
	});

	test("a link without an address is refused instead of guessed", () => {
		expect(parseLink("piremote:///session?token=abc")).toBeUndefined();
		expect(parseLink("not a link")).toBeUndefined();
	});
});

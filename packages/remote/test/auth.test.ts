import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type Asking,
	authorize,
	checkPlace,
	COOKIE,
	cookieOf,
	loginCookie,
	Logins,
	loopbackHosts,
	TOKEN_MS,
} from "../src/daemon/auth.ts";

let dir = "";
let now = 1_000_000;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pr-auth-"));
	now = 1_000_000;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function logins(): Logins {
	return new Logins(join(dir, "logins.json"), () => now);
}

describe("a token", () => {
	test("gets a login once, and only within 60 seconds", () => {
		const keeper = logins();
		const first = keeper.issue();
		expect(first.expiresAt).toBe(now + TOKEN_MS);
		const cookie = keeper.exchange(first.token);
		expect(cookie).toBeString();
		expect(keeper.has(cookie)).toBe(true);
		expect(keeper.exchange(first.token)).toBeUndefined();
		const late = keeper.issue();
		now += TOKEN_MS + 1;
		expect(keeper.exchange(late.token)).toBeUndefined();
	});

	test("that nobody issued gets nothing", () => {
		expect(logins().exchange("made-up")).toBeUndefined();
	});
});

describe("a login", () => {
	test("survives a restart, and the file holds neither the cookie nor the token", () => {
		const keeper = logins();
		const { token } = keeper.issue();
		const cookie = keeper.exchange(token) ?? "";
		const file = join(dir, "logins.json");
		const text = readFileSync(file, "utf8");
		expect(text).not.toContain(cookie);
		expect(text).not.toContain(token);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(logins().has(cookie)).toBe(true);
	});

	test("lapses after a year unused, and use keeps it", () => {
		const keeper = logins();
		const kept = keeper.exchange(keeper.issue().token) ?? "";
		const idle = keeper.exchange(keeper.issue().token) ?? "";
		now += 200 * 24 * 60 * 60_000;
		expect(keeper.has(kept)).toBe(true);
		now += 200 * 24 * 60 * 60_000;
		expect(keeper.has(kept)).toBe(true);
		expect(keeper.has(idle)).toBe(false);
	});

	test("unused for over a year, is no login even before anything rewrites the file", () => {
		const keeper = logins();
		const cookie = keeper.exchange(keeper.issue().token) ?? "";
		now += 366 * 24 * 60 * 60_000;
		expect(keeper.has(cookie)).toBe(false);
	});

	test("an empty or unknown cookie is no login, and a broken file starts with none", () => {
		writeFileSync(join(dir, "logins.json"), "not json");
		const keeper = logins();
		expect(keeper.has(undefined)).toBe(false);
		expect(keeper.has("")).toBe(false);
		expect(keeper.has("someone-elses")).toBe(false);
	});
});

describe("a request", () => {
	const hosts = loopbackHosts(7878);

	function decide(asking: Partial<Asking>, keeper = logins()) {
		return authorize(
			{
				method: "GET",
				path: "/sessions",
				host: "127.0.0.1:7878",
				origin: undefined,
				cookie: undefined,
				upgrade: false,
				...asking,
			},
			{ hosts, logins: keeper, isAppFile: (path) => path === "/" || path === "/app.js" },
		);
	}

	function loggedIn(keeper: Logins): string {
		return `${COOKIE}=${keeper.exchange(keeper.issue().token) ?? ""}`;
	}

	test("to a Host the daemon does not answer to gets 421, before anything else", () => {
		const keeper = logins();
		const cookie = loggedIn(keeper);
		expect(decide({ host: "evil.example:7878", cookie }, keeper)).toMatchObject({ status: 421 });
		expect(decide({ host: undefined, cookie }, keeper)).toMatchObject({ status: 421 });
		expect(decide({ host: "LOCALHOST:7878", cookie }, keeper)).toEqual({ ok: true });
	});

	test("needs a login, except for the app's files and the open routes", () => {
		expect(decide({})).toMatchObject({ ok: false, status: 401 });
		expect(decide({ path: "/" })).toEqual({ ok: true });
		expect(decide({ path: "/app.js" })).toEqual({ ok: true });
		expect(decide({ path: "/health" })).toEqual({ ok: true });
		expect(decide({ path: "/.well-known/pi-remote" })).toEqual({ ok: true });
		expect(decide({ method: "POST", path: "/login", origin: "http://127.0.0.1:7878" })).toEqual({
			ok: true,
		});
	});

	test("with the login cookie passes, among other cookies", () => {
		const keeper = logins();
		expect(decide({ cookie: `theme=dark; ${loggedIn(keeper)}` }, keeper)).toEqual({ ok: true });
	});

	test("from another origin gets 403 when it opens a WebSocket or changes something, cookie or not", () => {
		const keeper = logins();
		const cookie = loggedIn(keeper);
		const ws = { path: "/ws", upgrade: true, cookie };
		expect(decide({ ...ws, origin: "https://evil.example" }, keeper)).toMatchObject({
			status: 403,
		});
		expect(decide({ ...ws, origin: undefined }, keeper)).toMatchObject({ status: 403 });
		expect(decide({ ...ws, origin: "http://localhost:7878" }, keeper)).toEqual({ ok: true });
		const post = { method: "POST", path: "/sessions", cookie };
		expect(decide({ ...post, origin: "http://evil.example" }, keeper)).toMatchObject({
			status: 403,
		});
		expect(decide({ ...post, origin: "http://127.0.0.1:7878" }, keeper)).toEqual({ ok: true });
	});

	test("opening a WebSocket needs the login too, even from the daemon's own origin", () => {
		expect(decide({ path: "/ws", upgrade: true, origin: "http://127.0.0.1:7878" })).toMatchObject({
			status: 401,
		});
		expect(decide({ path: "/", upgrade: true, origin: "http://127.0.0.1:7878" })).toMatchObject({
			status: 401,
		});
	});
});

describe("where a request comes from", () => {
	const hosts = loopbackHosts(7878);
	const asking: Asking = {
		method: "GET",
		path: "/sessions",
		host: "127.0.0.1:7878",
		origin: undefined,
		cookie: undefined,
		upgrade: false,
	};

	test("is checked without any login, so a daemon with no login yet still refuses a page of another site", () => {
		expect(checkPlace(asking, hosts)).toEqual({ ok: true });
		expect(checkPlace({ ...asking, host: "attacker.example:7878" }, hosts)).toMatchObject({
			status: 421,
		});
		expect(
			checkPlace({ ...asking, path: "/ws", upgrade: true, origin: "https://evil.example" }, hosts),
		).toMatchObject({ status: 403 });
		expect(checkPlace({ ...asking, origin: "not a url", method: "POST" }, hosts)).toMatchObject({
			status: 403,
		});
		expect(
			checkPlace({ ...asking, origin: "file:///index.html", method: "POST" }, hosts),
		).toMatchObject({ status: 403 });
		// The daemon's own host under a scheme no page has is still not the daemon's page.
		expect(
			checkPlace({ ...asking, origin: "ws://127.0.0.1:7878", method: "POST" }, hosts),
		).toMatchObject({ status: 403 });
	});
});

describe("the cookie", () => {
	test("is read from a Cookie header among others", () => {
		expect(cookieOf(`a=1; ${COOKIE}=abc; b=2`)).toBe("abc");
		expect(cookieOf("a=1")).toBeUndefined();
		expect(cookieOf(undefined)).toBeUndefined();
	});

	test("is set HttpOnly and strict to its site, and secure only over TLS", () => {
		expect(loginCookie("abc", false)).toBe(
			`${COOKIE}=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
		);
		expect(loginCookie("abc", true).endsWith("; Secure")).toBe(true);
	});
});

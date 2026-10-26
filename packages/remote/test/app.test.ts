import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	fileFor,
	isAppFile,
	loadWebApp,
	POLICY,
	serveApp,
	type WebApp,
} from "../src/daemon/app.ts";
import { Daemon } from "../src/daemon/server.ts";
import { logIn } from "./login.ts";

let dir: string;
const running: Daemon[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-remote-app-"));
});

afterEach(() => {
	for (const daemon of running.splice(0)) daemon.stop();
	rmSync(dir, { recursive: true, force: true });
});

const PAGE =
	'<!doctype html><div id="root"></div><script type="module" src="/assets/index-1234.js"></script>';

/** A build shaped like the page's: the one page, its hashed bundle, and what `public/` copies. */
function built(extra: Record<string, string> = {}): string {
	const root = join(dir, "web");
	const files: Record<string, string> = {
		"index.html": PAGE,
		"assets/index-1234.js": "console.log(1)",
		"favicon.png": "png",
		...extra,
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

function appOf(extra: Record<string, string> = {}): WebApp {
	const app = loadWebApp(built(extra));
	if (app === undefined) throw new Error("no app");
	return app;
}

describe("the page's build", () => {
	test("answers its own files, the page for its routes, and nothing made up", () => {
		const app = appOf();
		expect(fileFor(app, "/")).toBe("/index.html");
		expect(fileFor(app, "/favicon.png")).toBe("/favicon.png");
		expect(fileFor(app, "/assets/index-1234.js")).toBe("/assets/index-1234.js");
		expect(fileFor(app, "/session/laptop/01a16e22")).toBe("/index.html");
		expect(fileFor(app, "/session/laptop/01a16e22/")).toBe("/index.html");
		// The routes the daemon answers itself must not be eaten by the page.
		expect(fileFor(app, "/login")).toBeUndefined();
		expect(fileFor(app, "/sessions")).toBeUndefined();
		expect(fileFor(app, "/session/laptop")).toBeUndefined();
		expect(fileFor(app, "/session/laptop/s1/more")).toBeUndefined();
		expect(fileFor(app, "/x.js")).toBeUndefined();
		// Only what was there when the daemon read the folder: a file written later is not served.
		writeFileSync(join(dir, "web", "secret.txt"), "no");
		expect(isAppFile(app, "/secret.txt")).toBe(false);
	});

	test("a new build while the daemon runs is served whole, and the old one's files are gone", () => {
		const app = appOf();
		const root = join(dir, "web");
		rmSync(join(root, "assets"), { recursive: true });
		mkdirSync(join(root, "assets"));
		writeFileSync(join(root, "assets", "index-5678.js"), "console.log(2)");
		writeFileSync(join(root, "index.html"), PAGE.replace("1234", "5678"));
		utimesSync(join(root, "index.html"), new Date(), new Date(Date.now() + 60_000));
		expect(fileFor(app, "/assets/index-5678.js")).toBe("/assets/index-5678.js");
		expect(fileFor(app, "/assets/index-1234.js")).toBeUndefined();
	});

	test("every file comes with the policy, a hashed asset is cached for good, and the page is not", () => {
		const app = appOf();
		const page = serveApp(app, "/");
		expect(page.status).toBe(200);
		expect(page.headers["content-security-policy"]).toBe(POLICY);
		expect(POLICY.split("; ")).toContain("script-src 'self'");
		expect(page.headers["cache-control"]).toBe("no-cache");
		const bundle = serveApp(app, "/assets/index-1234.js");
		expect(bundle.headers["cache-control"]).toContain("immutable");
		expect(bundle.type).toContain("javascript");
		expect(serveApp(app, "/nowhere").status).toBe(404);
	});

	test("a folder with no page is no build", () => {
		mkdirSync(join(dir, "empty"));
		expect(loadWebApp(join(dir, "empty"))).toBeUndefined();
	});
});

describe("the daemon serving the app", () => {
	/** A daemon with the build in `webDir`, asked once without a login and once with one. */
	async function daemonWith(webDir: string) {
		const daemon = await Daemon.start({
			socket: join(dir, "remote", "daemon.sock"),
			version: "1.2.0",
			clientPort: 0,
			webDir,
		});
		if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
		running.push(daemon);
		const origin = `http://127.0.0.1:${daemon.clientPort}`;
		const cookie = await logIn(daemon, daemon.clientPort);
		return {
			get: (path: string) => fetch(`${origin}${path}`),
			loggedIn: (path: string) => fetch(`${origin}${path}`, { headers: { Cookie: cookie } }),
		};
	}

	test("serves its files with no login, and a page named like a route never opens the route", async () => {
		appOf({ sessions: "a file that must not answer" });
		const { get, loggedIn } = await daemonWith(join(dir, "web"));
		// A file named `sessions` would answer `/sessions` as a page, so the list would need no login.
		expect((await get("/sessions")).status).toBe(401);
		const sessions = await loggedIn("/sessions");
		expect(sessions.headers.get("content-type")).toContain("application/json");
		expect(await sessions.json()).toEqual([]);
		const page = await get("/");
		expect(page.status).toBe(200);
		expect(page.headers.get("content-security-policy")).toBe(POLICY);
		expect((await get("/session/laptop/s1")).status).toBe(200);
		expect((await get("/assets/index-1234.js")).status).toBe(200);
		// A path the build lacks is not one of its files, so it needs a login before its 404.
		expect((await get("/nowhere")).status).toBe(401);
		expect((await loggedIn("/nowhere")).status).toBe(404);
	});

	test("without a build, the daemon serves its data routes and nothing else", async () => {
		const { get, loggedIn } = await daemonWith(join(dir, "nothing"));
		expect((await get("/health")).status).toBe(200);
		expect((await loggedIn("/sessions")).status).toBe(200);
		// With no build nothing is the page's, so even `/` needs a login.
		expect((await get("/")).status).toBe(401);
		expect((await loggedIn("/")).status).toBe(404);
	});
});

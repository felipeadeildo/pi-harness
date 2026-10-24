import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { packageWeb } from "../build.ts";
import { fileFor, isAppFile, loadWebApp, serveApp, type WebApp } from "../src/daemon/app.ts";
import { Daemon } from "../src/daemon/server.ts";
import { inlineHashes, POLICY } from "../src/daemon/web.ts";

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
	'<!doctype html><script>globalThis.__EXPO_ROUTER_HYDRATE__=true;</script><div id="root"></div>';

/** An export shaped like Expo's: pages, a hashed bundle, and a route with parameters. */
function exported(extra: Record<string, string> = {}): string {
	const root = join(dir, "export");
	const files: Record<string, string> = {
		"index.html": PAGE,
		"+not-found.html": "<!doctype html><p>no such page</p>",
		"_sitemap.html": "<!doctype html><p>sitemap</p>",
		"session/[machine]/[id].html": "<!doctype html><p>a session</p>",
		"_expo/static/js/web/entry-1234.js": "console.log(1)",
		"favicon.ico": "ico",
		...extra,
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

function appOf(extra: Record<string, string> = {}): WebApp {
	packageWeb(exported(extra), join(dir, "dist"));
	const app = loadWebApp(join(dir, "dist", "web"));
	if (app === undefined) throw new Error("no app");
	return app;
}

describe("the web app's export", () => {
	test("is copied next to the daemon with a list of every file, as paths from /", () => {
		const files = packageWeb(exported(), join(dir, "dist"));
		expect(files).toContain("/index.html");
		expect(files).toContain("/_expo/static/js/web/entry-1234.js");
		expect(files).toContain("/session/[machine]/[id].html");
		const listed = JSON.parse(readFileSync(join(dir, "dist", "web", "files.json"), "utf8"));
		expect(listed).toEqual(files);
	});

	test("answers a path with its file, its page, or the page of a route with parameters", () => {
		const app = appOf();
		expect(fileFor(app, "/")).toBe("/index.html");
		expect(fileFor(app, "/_sitemap")).toBe("/_sitemap.html");
		expect(fileFor(app, "/favicon.ico")).toBe("/favicon.ico");
		expect(fileFor(app, "/session/laptop/01a16e22")).toBe("/session/[machine]/[id].html");
		expect(fileFor(app, "/session/laptop")).toBeUndefined();
		expect(fileFor(app, "/session/laptop/s1/more")).toBeUndefined();
		// Only what the build listed: a real file the list does not name is not served.
		writeFileSync(join(dir, "dist", "web", "secret.txt"), "no");
		expect(fileFor(app, "/secret.txt")).toBeUndefined();
		// The list itself is the daemon's, not the app's.
		expect(isAppFile(app, "/files.json")).toBe(false);
		expect(isAppFile(app, "/index.html")).toBe(true);
		expect(isAppFile(app, "/sessions")).toBe(false);
	});

	test("a page comes with the policy for its own inline script, and a bundle with the base one", () => {
		const app = appOf();
		const page = serveApp(app, "/");
		expect(page.status).toBe(200);
		expect(page.headers["content-security-policy"]).toContain(inlineHashes(PAGE)[0]);
		const bundle = serveApp(app, "/_expo/static/js/web/entry-1234.js");
		expect(bundle.headers["content-security-policy"]).toBe(POLICY);
		expect(bundle.headers["cache-control"]).toContain("immutable");
		expect(bundle.type).toContain("javascript");
		const missing = serveApp(app, "/nowhere");
		expect(missing.status).toBe(404);
		expect(String(missing.body)).toContain("no such page");
	});
});

describe("the daemon serving the app", () => {
	async function served(extra: Record<string, string> = {}) {
		appOf(extra);
		const daemon = await Daemon.start({
			socket: join(dir, "remote", "daemon.sock"),
			version: "1.2.0",
			clientPort: 0,
			webDir: join(dir, "dist", "web"),
		});
		if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
		running.push(daemon);
		return (path: string) => fetch(`http://127.0.0.1:${daemon.clientPort}${path}`);
	}

	test("answers the data routes first, so a file named like one never answers for it", async () => {
		const get = await served({ "sessions.html": "<p>a file that must not answer</p>" });
		const sessions = await get("/sessions");
		expect(sessions.headers.get("content-type")).toContain("application/json");
		expect(await sessions.json()).toEqual([]);
		const page = await get("/");
		expect(page.status).toBe(200);
		expect(page.headers.get("content-security-policy")).toContain("sha256-");
		expect((await get("/session/laptop/s1")).status).toBe(200);
		expect((await get("/nowhere")).status).toBe(404);
	});

	test("a list that does not read costs the app, and the data routes still answer", async () => {
		appOf();
		writeFileSync(join(dir, "dist", "web", "files.json"), "{ not json");
		expect(loadWebApp(join(dir, "dist", "web"))).toBeUndefined();
		const daemon = await Daemon.start({
			socket: join(dir, "remote", "daemon.sock"),
			version: "1.2.0",
			clientPort: 0,
			webDir: join(dir, "dist", "web"),
		});
		if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
		running.push(daemon);
		const get = (path: string) => fetch(`http://127.0.0.1:${daemon.clientPort}${path}`);
		expect((await get("/health")).status).toBe(200);
		expect((await get("/")).status).toBe(404);
	});

	test("without an export, the daemon serves its data routes and nothing else", async () => {
		const daemon = await Daemon.start({
			socket: join(dir, "remote", "daemon.sock"),
			version: "1.2.0",
			clientPort: 0,
			webDir: join(dir, "nothing"),
		});
		if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
		running.push(daemon);
		const get = (path: string) => fetch(`http://127.0.0.1:${daemon.clientPort}${path}`);
		expect((await get("/health")).status).toBe(200);
		expect((await get("/")).status).toBe(404);
	});
});

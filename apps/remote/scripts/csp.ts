// Serves the exported app with the CSP the design asks for and loads it in a headless browser. A
// policy that the app violates is the failure the type check and the lint cannot see: they run
// before the bundle exists.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

import { type Browser, chromium } from "playwright-core";

const DIST = join(import.meta.dir, "..", "dist");
/** Where a browser is, if this machine has one: the CI runner does, a contributor's laptop may not. */
const BROWSERS = [
	"/usr/bin/google-chrome-stable",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function browserPath(): string | undefined {
	if (process.env.CHROME_PATH !== undefined) return process.env.CHROME_PATH;
	return BROWSERS.find((path) => existsSync(path));
}

/**
 * Every request the app makes to its own origin, plus the daemon's socket once it is wired. The
 * export writes one inline script, so the page is served with that script's hash rather than with
 * `unsafe-inline`: the same rule the daemon follows when it reads the build.
 */
export const POLICY = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self' data:",
	"connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
	"object-src 'none'",
].join("; ");

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ttf": "font/ttf",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
};

/** The hash of every inline script the page carries, as the policy spells them. */
export function inlineHashes(html: string): string[] {
	// `data-src` is not a source: a script tag with one is inline, and the browser hashes its text.
	return [...html.matchAll(/<script(?![^>]*(?<![-\w])src=)[^>]*>([\s\S]*?)<\/script>/g)].map(
		([, body = ""]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
	);
}

/** The policy for one page: the base rules, plus the hashes of what it inlines. */
export function policyFor(html: string): string {
	const hashes = inlineHashes(html);
	if (hashes.length === 0) return POLICY;
	return POLICY.replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`);
}

export interface Served {
	url: string;
	stop(): void;
}

/** The exported folder behind the policy, so the browser sees what the daemon will serve. */
export function serve(): Served {
	if (!existsSync(join(DIST, "index.html"))) {
		throw new Error(`nothing exported in ${DIST}: run the app's export first`);
	}
	const server = Bun.serve({
		// Loopback only: this serves a test page, and nothing else on the network should reach it.
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = normalize(new URL(request.url).pathname);
			const file = safeFile(path) ?? safeFile(join(path, "index.html"));
			if (file === undefined) {
				console.error("missing", path);
				return new Response("not found", { status: 404 });
			}
			if (extname(file) !== ".html") {
				return new Response(Bun.file(file), {
					headers: { "content-security-policy": POLICY, "content-type": typeOf(file) },
				});
			}
			// One read: the body and the hashes come from the same text, so they cannot disagree.
			const page = readFileSync(file, "utf8");
			return new Response(page, {
				headers: { "content-security-policy": policyFor(page), "content-type": typeOf(file) },
			});
		},
	});
	return { url: `http://127.0.0.1:${server.port}/`, stop: () => void server.stop(true) };
}

function typeOf(file: string): string {
	return TYPES[extname(file)] ?? "application/octet-stream";
}

function safeFile(path: string): string | undefined {
	const full = join(DIST, path);
	if (!full.startsWith(DIST + sep)) return undefined;
	if (!existsSync(full) || !statSync(full).isFile()) return undefined;
	return full;
}

/** What the browser said was blocked, or an error it logged. */
export async function violations(url: string, browser?: Browser): Promise<string[]> {
	const found: string[] = [];
	const running =
		browser ?? (await chromium.launch({ executablePath: browserPath(), headless: true }));
	try {
		return await inspect(running, url, found);
	} finally {
		// The browser is closed here, whatever the page did, so a failure is one line and no orphan.
		if (browser === undefined) await running.close();
	}
}

/** The page's own half of the check. */
async function inspect(running: Browser, url: string, found: string[]): Promise<string[]> {
	const page = await running.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") found.push(`console: ${message.text()}`);
	});
	page.on("pageerror", (error) => found.push(`page: ${String(error)}`));
	page.on("response", (answer) => {
		if (answer.status() >= 400) found.push(`${answer.status()} ${answer.url()}`);
	});
	const response = await page.goto(url, { waitUntil: "networkidle" });
	if (response === null || !response.ok()) found.push(`the page answered ${response?.status()}`);
	return found;
}

if (import.meta.main) {
	// A check that fails on a machine without a browser teaches contributors to skip it. The CI job
	// has one, and says so when it is missing.
	const browser = browserPath();
	if (browser === undefined) {
		// A contributor without Chrome is not blocked. The CI job has one, and a job that prints
		// "skipped" and stays green is a check nobody is running.
		if (process.env.CI !== undefined) {
			console.error("no browser on this machine, and the check is required here: set CHROME_PATH");
			process.exit(1);
		}
		console.log("skipped: no browser on this machine");
		process.exit(0);
	}
	if (!existsSync(browser)) {
		console.error(`the browser at ${browser} is not there: set CHROME_PATH, or unset it`);
		process.exit(1);
	}
	const served = serve();
	try {
		const found = await violations(served.url);
		if (found.length > 0) {
			console.error(found.join("\n"));
			process.exit(1);
		}
		console.log(`the app loads under the policy, with nothing blocked: ${served.url}`);
	} finally {
		served.stop();
	}
}

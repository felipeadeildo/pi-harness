// Serves the exported app through the daemon's own HTTP server and loads it in a headless browser, so
// the check sees the routes, the file list and the policy a real daemon uses. A policy that the app
// violates is the failure the type check and the lint cannot see: they run before the bundle exists.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { serveExport } from "@adeildo/pi-remote/preview";
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
		// The browser logs a failed request of its own; the response handler above already judges those,
		// and a duplicate here would report the same 401 twice.
		if (message.type() === "error" && !message.text().includes("Failed to load resource"))
			found.push(`console: ${message.text()}`);
	});
	page.on("pageerror", (error) => found.push(`page: ${String(error)}`));
	page.on("response", (answer) => {
		// 401 and 403 are the answer a page without a login token gets from the data routes. The check
		// proves that nothing was blocked, not that it can log in, and counting them here would report
		// an auth story as a policy violation.
		if (answer.status() >= 400 && answer.status() !== 401 && answer.status() !== 403)
			found.push(`${answer.status()} ${answer.url()}`);
	});
	// `load`, not `networkidle`: the app keeps a WebSocket open for the session it draws, so the network
	// never goes idle and a check that waits for it can only time out. What the check is after is the
	// page having run its own code, which `load` already means.
	const response = await page.goto(url, { waitUntil: "load" });
	// One tick for the first frame and the socket handshake, so a violation raised there is seen.
	await page.waitForTimeout(500);
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
	if (!existsSync(join(DIST, "index.html"))) {
		console.error(`nothing exported in ${DIST}: run the app's export first`);
		process.exit(1);
	}
	const served = await serveExport(DIST);
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

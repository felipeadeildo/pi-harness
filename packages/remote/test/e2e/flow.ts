// The gate, in a real browser: the daemon the bridge starts, the app it serves, and the flow the plan
// calls done. One line per step, so a step a fix turns green shows up here instead of staying hidden
// behind the ones still failing. Run it with the package's `bun run gate`.
import { mkdtempSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { type Browser, chromium, type Page } from "playwright-core";

import { requestLink } from "../../src/cli/open.ts";
import piRemote from "../../src/index.ts";
import { daemonPaths } from "../../src/places.ts";

/** Where a browser is, if this machine has one. The CI runner does; a laptop may not. */
const BROWSERS = [
	"/usr/bin/google-chrome-stable",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const STEPS = [
	"the daemon's link opens the app, and the session list is there",
	"the list leads to the session's screen",
	"a prompt sent to an idle session runs",
	"a follow-up sent during a run waits in the queue, and can be taken back",
	"a question the model asks is answered in the browser",
	"after the daemon restarts, a reloaded page still draws tasks and mode",
	"a command typed offline goes out after the reload",
] as const;

type Result = { ok: boolean; why?: string };
type Report = Result & { step: number };

let rig: Rig | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let root = "";

function browserPath(): string | undefined {
	if (process.env.CHROME_PATH !== undefined) return process.env.CHROME_PATH;
	return BROWSERS.find((path) => existsSync(path));
}

async function main(): Promise<number> {
	root = mkdtempSync(join(tmpdir(), "pi-remote-gate-"));
	process.env.PI_REMOTE_DIR = root;
	process.env.PI_REMOTE_SHARE = "1";
	const reports: Report[] = [];
	try {
		// The bridge starts the daemon when none answers, which is the path a user takes.
		rig = await createRig({
			extensions: [piRemote],
			answer: () => fauxAssistantMessage("Answered."),
		});
		const link = await waitForLink();
		if ("url" in link) {
			browser = await chromium.launch({ executablePath: browserPath(), headless: true });
			page = await browser.newPage();
			// The gate moves time: the outbox window is two minutes, and a test does not wait them.
			await page.clock.install();
			await page.goto(link.url);
			reports.push({ step: 1, ...(await seesList(page)) });
			reports.push({ step: 2, ...(await opensSession(page)) });
		} else {
			reports.push({ step: 1, ok: false, why: link.why });
		}
	} finally {
		await browser?.close();
		browser = undefined;
		rig?.dispose();
		rig = undefined;
		rmSync(root, { recursive: true, force: true });
		delete process.env.PI_REMOTE_DIR;
		delete process.env.PI_REMOTE_SHARE;
	}
	for (const [at, name] of STEPS.entries()) {
		const report = reports.find((one) => one.step === at + 1);
		const mark = report?.ok === true ? "pass" : "fail";
		console.log(
			`${mark}  ${at + 1}. ${name}${report?.why === undefined ? "" : ` — ${report.why}`}`,
		);
	}
	return reports.length === STEPS.length && reports.every((one) => one.ok) ? 0 : 1;
}

/** The daemon the bridge started, found by the socket it leaves in the remote's folder. */
async function waitForLink(): Promise<{ url: string } | { why: string }> {
	const { socket } = daemonPaths(root);
	const deadline = Date.now() + 30_000;
	for (;;) {
		const link = await requestLink(socket);
		if ("url" in link) return link;
		if (Date.now() > deadline) return { why: link.reason };
		await Bun.sleep(100);
	}
}

/** Every session the daemon knows is a row, and each row is the link to its screen. */
async function seesList(page: Page): Promise<Result> {
	const rows = page.locator("a[href*='/session/']");
	try {
		await rows.first().waitFor({ timeout: 30_000 });
		return { ok: (await rows.count()) > 0 };
	} catch (error) {
		return { ok: false, why: `no session link (${short(error)})` };
	}
}

/** The row opens the screen, which draws the conversation and the composer. */
async function opensSession(page: Page): Promise<Result> {
	try {
		const row = page.locator("a[href*='/session/']").first();
		const href = await row.getAttribute("href");
		await row.click();
		if (href !== null) await page.waitForURL(`**${href}`, { timeout: 30_000 });
		await page.locator(".remote-composer").first().waitFor({ timeout: 30_000 });
		return { ok: true };
	} catch (error) {
		return { ok: false, why: short(error) };
	}
}

function short(error: unknown): string {
	return (
		String(error instanceof Error ? error.message : error)
			.split("\n")[0]
			?.slice(0, 120) ?? "unknown"
	);
}

process.exit(await main());

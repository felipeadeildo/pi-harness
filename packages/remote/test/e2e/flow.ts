// The gate, in a real browser: the daemon the bridge starts, the app it serves, and the flow the plan
// calls done. One line per step, so a step a fix turns green shows up here instead of staying hidden
// behind the ones still failing. Run it with the package's `bun run gate`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import permission from "@adeildo/pi-ask-permission";
import piQuestions from "@adeildo/pi-ask-questions";
import { TOOL_NAME } from "@adeildo/pi-ask-questions";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { type Browser, chromium, type Page } from "playwright-core";

import { requestLink } from "../../src/cli/open.ts";
import { findWebDir } from "../../src/daemon/app.ts";
import piRemote from "../../src/index.ts";
import { readCurrent } from "../../src/launcher.ts";
import { daemonPaths } from "../../src/places.ts";

/** Where a browser is, if this machine has one. The CI runner does; a laptop may not. */
const BROWSERS = [
	"/usr/bin/google-chrome-stable",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * The steps a run has to pass. A step becomes mandatory the day it passes and stays so; the ones
 * still red are reported and do not hold a merge, which is what keeps this file useful before the
 * last fix lands.
 */
const MANDATORY: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/** The steps with a body. The rest are named and not written: a report that says `fail` for them
 * claims a measurement nobody made, and a reader cannot tell that from a step that ran and broke. */
const WRITTEN: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6]);

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
	const system = BROWSERS.find((path) => existsSync(path));
	if (system !== undefined) return system;
	// A machine that ran Playwright's own installer has a browser in its cache, under a versioned
	// folder: take the newest, because the one the tests name may not be the one that is there.
	const cache = join(homedir(), ".cache", "ms-playwright");
	if (!existsSync(cache)) return undefined;
	const builds = readdirSync(cache)
		.filter((name) => name.startsWith("chromium-"))
		.sort()
		.at(-1);
	if (builds === undefined) return undefined;
	for (const binary of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
		const at = join(cache, builds, binary);
		if (existsSync(at)) return at;
	}
	return undefined;
}

async function main(): Promise<number> {
	root = mkdtempSync(join(tmpdir(), "pi-remote-gate-"));
	process.env.PI_REMOTE_DIR = root;
	process.env.PI_REMOTE_SHARE = "1";
	// A port of its own: two runs at once, or a daemon left behind, would fight for 7878 and the
	// loser would report a taken port as if it were a bug. It goes through the rig's settings file,
	// which is the one pi reads, nested the way that file groups an id.
	const port = await freePort();
	const reports: Report[] = [];
	try {
		// The daemon serves the export it finds at startup, and a checkout has none until it builds.
		// Asking the daemon's own function keeps `PI_REMOTE_WEB` working and the message true if the
		// candidates change; the failure it prevents is a red step 1 that reads like a broken screen.
		if (findWebDir(join(import.meta.dir, "..", "..", "dist")) === undefined) {
			console.error(
				"gate: the app is not packaged beside the daemon; run `bun run --cwd packages/remote build` (`app:export` alone is not enough)",
			);
			return 1;
		}
		// The bridge starts the daemon when none answers, which is the path a user takes.
		rig = await createRig({
			// The permission feature owns the session mode, and the composer offers it: without it the picker
			// would promise a change the session cannot make.
			extensions: [piRemote, piQuestions, permission],
			// A prompt that says "ask me" gets a question back, and its answer goes on as words. Every
			// other prompt is words, and slow enough that a run is still going when the next step types:
			// a follow-up is only a follow-up while something else runs.
			answer: (context) =>
				lastSaid(context).includes("slow answer")
					? fauxAssistantMessage(`${"Answered, one word after another. ".repeat(60)}`.trim())
					: lastSaid(context).includes("ask me")
						? fauxAssistantMessage([
								fauxToolCall(TOOL_NAME, {
									questions: [
										{
											header: "Deploy",
											question: "Ship the release now?",
											options: [
												{ label: "Ship it", description: "Publish today." },
												{ label: "Wait", description: "Publish tomorrow." },
											],
										},
									],
								}),
							])
						: fauxAssistantMessage("Answered, one word after another, slowly."),
			// Fast enough that a tool call's JSON arrives in about a second, slow enough that the long
			// answer below still takes seconds to write out.
			tokensPerSecond: 50,
			settings: { remote: { port } },
		});
		const link = await waitForLink();
		if ("url" in link) {
			browser = await chromium.launch({ executablePath: browserPath(), headless: true });
			page = await browser.newPage();
			// What the page says when it fails is the difference between "the app did not load" and
			// "the app loaded and drew nothing", and only the console tells them apart.
			page.on("console", (line) => {
				if (line.type() === "error") console.error(`page: ${line.text().slice(0, 160)}`);
			});
			page.on("pageerror", (error) => console.error(`page threw: ${String(error).slice(0, 160)}`));
			// The gate moves time: the outbox window is two minutes, and a test does not wait them.
			await page.clock.install();
			await page.goto(link.url);
			reports.push({ step: 1, ...(await seesList(page)) });
			reports.push({ step: 2, ...(await opensSession(page)) });
			reports.push({ step: 3, ...(await sendsPrompt(page, rig)) });
			reports.push({ step: 4, ...(await queuesFollowUp(page, rig)) });
			reports.push({ step: 5, ...(await answersQuestion(page, rig)) });
			reports.push({ step: 6, ...(await survivesRestart(page)) });
		} else {
			reports.push({ step: 1, ok: false, why: link.why });
		}
	} finally {
		stopDaemon();
		await browser?.close();
		browser = undefined;
		rig?.dispose();
		rig = undefined;
		rmSync(root, { recursive: true, force: true });
		delete process.env.PI_REMOTE_DIR;
		delete process.env.PI_REMOTE_SHARE;
	}
	// The daemon this run started is gone: `stopDaemon` is what makes the next run able to listen,
	// and a signal 0 is how the same run can tell that it worked.
	const holder = readCurrent(root)?.pid;
	if (holder !== undefined) {
		try {
			process.kill(holder, 0);
			console.error(`gate: the daemon ${holder} outlived the run`);
			reports.push({ step: 0, ok: false, why: `the daemon ${holder} outlived the run` });
		} catch {
			// The process is gone, which is what the end of a run asks for.
		}
	}

	for (const [at, name] of STEPS.entries()) {
		if (!WRITTEN.has(at + 1)) {
			console.log(`not written yet  ${at + 1}. ${name}`);
			continue;
		}
		const report = reports.find((one) => one.step === at + 1);
		const mark = report?.ok === true ? "pass" : "fail";
		console.log(
			`${mark}  ${at + 1}. ${name}${report?.why === undefined ? "" : ` — ${report.why}`}`,
		);
	}
	const failed = reports.filter((one) => MANDATORY.has(one.step) && !one.ok);
	return failed.length === 0 ? 0 : 1;
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
		const text = (
			await page
				.locator("body")
				.innerText()
				.catch(() => "")
		).slice(0, 160);
		return { ok: false, why: `no session link (${short(error)}) at ${page.url()}: ${text}` };
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

/**
 * A prompt sent from the browser reaches the session and the model answers. The session is idle when
 * the prompt arrives, which is the case #188 fixed: the letter goes in at once instead of waiting for
 * a settle that never comes.
 */
/**
 * A prompt typed in the browser, and the three things that have to happen for it to count: the field
 * takes the text, the screen sends it, and the session's branch grows. Each has its own sentence,
 * because "the branch did not grow" covered three different failures for an afternoon.
 */
async function sendsPrompt(page: Page, rig: Rig): Promise<Result> {
	try {
		// Counted before the click, not after: the scripted model answers at once, so a run that starts
		// and ends between the click and the first read looks like no run at all.
		const entries = (): number => rig.session.sessionManager.getBranch().length;
		const before = entries();
		const box = page.locator("input[name='prompt']").first();
		await box.click({ timeout: 20_000 });
		await box.fill("say hello from the gate");
		if ((await box.inputValue()) !== "say hello from the gate")
			return { ok: false, why: "the field did not take the text" };
		// The composer has two buttons whose name starts with "Send" ("Send" and "Send now"), and a
		// click on a disabled one does nothing: exact, and then the field must be empty afterwards.
		await page.getByRole("button", { name: "Send", exact: true }).click({ timeout: 20_000 });
		if ((await box.inputValue()) !== "")
			return { ok: false, why: "the screen did not send: the field still holds the text" };

		const deadline = Date.now() + 20_000;
		while (entries() <= before && Date.now() < deadline) await Bun.sleep(100);
		if (entries() > before) return { ok: true };
		const seen = await rig
			.until((line) => line.type === "prompt.received", 2_000)
			.then(() => true)
			.catch(() => false);
		return {
			ok: false,
			why: seen
				? "the bridge logged the prompt and pi never started: the inbox or the delivery"
				: "the prompt never reached the bridge: the outbox or the wire",
		};
	} catch (error) {
		return { ok: false, why: short(error) };
	}
}

/**
 * A message sent while a run is going waits in the session's queue, and the person can take it back.
 * Both halves are read where the person reads them: the row in the composer, and its withdrawal. The
 * queue is the property; the announcement that it changed is only how the screen hears of it.
 */
async function queuesFollowUp(page: Page, rig: Rig): Promise<Result> {
	try {
		const box = page.locator("textarea, [contenteditable='true'], input[type='text']").first();
		// The step before left a run going; this one needs its own, or its first message is the one
		// that waits and the queue row is about the wrong prompt.
		const idle = Date.now() + 20_000;
		while (!rig.session.isIdle && Date.now() < idle) await Bun.sleep(50);
		await box.click({ timeout: 20_000 });
		await box.fill("first, a slow answer please");
		await page.keyboard.press("Enter");
		// The run is what makes the next message wait, so the step waits for it to start, on the event
		// the session is in, not on the branch having grown.
		const deadline = Date.now() + 20_000;
		const busy = (): boolean => !rig.session.isIdle;
		while (!busy() && Date.now() < deadline) await Bun.sleep(50);
		if (!busy()) return { ok: false, why: "the run never started" };

		await box.fill("wait for me");
		await page.keyboard.press("Enter");
		// The last row is the message this step just sent: an earlier one can still be waiting.
		const row = page.locator(".remote-composer-waiting").last();
		await row.waitFor({ timeout: 90_000 });
		const said = (await row.locator(".remote-composer-text").innerText()).trim();

		await row.getByRole("button", { name: "Withdraw", exact: true }).click();
		await page.locator(".remote-composer-held").waitFor({ state: "detached", timeout: 20_000 });
		return said === "wait for me" ? { ok: true } : { ok: false, why: `the queue showed "${said}"` };
	} catch (error) {
		return { ok: false, why: short(error) };
	}
}

/**
 * A question the model asks is answered in the browser. The question is the tool call the scripted
 * model returns; the answer goes back through the daemon to the session, and the proof is the
 * question closing — in the state the session carries — and the run going on to its words.
 */
async function answersQuestion(page: Page, rig: Rig): Promise<Result> {
	try {
		const box = page.locator("textarea, [contenteditable='true'], input[type='text']").first();
		await box.click({ timeout: 20_000 });
		await box.fill("ask me before you ship");
		await page.keyboard.press("Enter");

		// The option's accessible name carries its description, so the match is a prefix.
		const option = page.getByRole("button", { name: /^Ship it/ });
		try {
			// The scripted model writes the tool call at two tokens a second, so the JSON takes ~30 s.
			await option.waitFor({ timeout: 90_000 });
		} catch {
			const said = await page
				.locator("body")
				.innerText()
				.catch(() => "");
			return { ok: false, why: `no question: ${JSON.stringify(said.slice(0, 300))}` };
		}
		const before = rig.session.sessionManager.getBranch().length;
		await option.click();
		await page.getByRole("button", { name: "Send answer", exact: true }).click();

		// The question closed and the run went on: the dialog is gone, and the branch grew with the
		// answer the model read and the words it said after it.
		await option.waitFor({ state: "detached", timeout: 60_000 });
		const deadline = Date.now() + 60_000;
		while (rig.session.sessionManager.getBranch().length <= before && Date.now() < deadline)
			await Bun.sleep(50);
		return rig.session.sessionManager.getBranch().length > before
			? { ok: true }
			: { ok: false, why: "the run did not go on after the answer" };
	} catch (error) {
		return { ok: false, why: short(error) };
	}
}

/** What the person last typed, which is how the scripted model knows which turn it is answering. */
function lastSaid(context: { messages: readonly { role?: string; content?: unknown }[] }): string {
	const last = [...context.messages].reverse().find((one) => one.role === "user");
	const content = last?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (typeof part === "object" && part !== null && "text" in part ? part.text : ""))
		.filter((text): text is string => typeof text === "string")
		.join(" ");
}

/**
 * The daemon restarts and a reloaded page draws the session again, from the state the session sends:
 * the mode the person picked, and the question answered in step 5, which stays closed.
 */
async function survivesRestart(page: Page): Promise<Result> {
	try {
		const picker = page.locator("select[name='mode']");
		await picker.selectOption("edits", { timeout: 20_000 });
		// The select follows the state, so a mode that sticks is the state having taken it.
		const chosen = Date.now() + 20_000;
		while ((await picker.inputValue()) !== "edits" && Date.now() < chosen) await Bun.sleep(100);
		if ((await picker.inputValue()) !== "edits")
			return { ok: false, why: "the mode never stuck, before any restart" };

		// The daemon goes away, as a restart does.
		const holder = readCurrent(root)?.pid;
		if (holder === undefined) return { ok: false, why: "no daemon to restart" };
		process.kill(holder, "SIGTERM");
		const back = Date.now() + 45_000;
		while (readCurrent(root)?.pid === holder && Date.now() < back) await Bun.sleep(200);
		if (readCurrent(root)?.pid === holder) return { ok: false, why: "no daemon came back" };

		await page.reload({ waitUntil: "domcontentloaded" });
		await page.locator(".remote-composer").waitFor({ timeout: 60_000 });
		// The page draws from the state the session sends, and that state arrives when the bridge
		// registers with the new daemon: the daemon pushes it to whoever was waiting.
		const settled = Date.now() + 60_000;
		while ((await picker.inputValue()) !== "edits" && Date.now() < settled) await Bun.sleep(200);
		const mode = (await picker.inputValue()) === "edits";
		const closed = (await page.getByRole("button", { name: /^Ship it/ }).count()) === 0;
		return mode && closed
			? { ok: true }
			: { ok: false, why: `mode back=${mode}, question closed=${closed}` };
	} catch (error) {
		return { ok: false, why: short(error) };
	}
}

/**
 * The daemon the bridge started is detached and outlives this process, so the run that leaves one
 * behind makes the next run fail on a port it cannot have. It is found by the socket it holds.
 */
function stopDaemon(): void {
	// The socket is bound to a temporary name and renamed, so `lsof` on its path finds nothing: the
	// daemon writes the pid it has in `current.json`, and the pid is what stops it. `lsof` stays as the
	// reserve for a daemon from an older build, which never wrote one.
	const holder = readCurrent(root)?.pid;
	if (holder !== undefined) {
		try {
			process.kill(holder, "SIGTERM");
		} catch {
			// Already gone: the socket outlived it, and nothing else holds the port.
		}
	}
	const { socket } = daemonPaths(root);
	const found = spawnSync("lsof", ["-t", `--`, socket], { encoding: "utf8" });
	for (const pid of (found.stdout ?? "").split("\n")) {
		const at = Number(pid.trim());
		if (Number.isInteger(at) && at > 0) {
			try {
				process.kill(at, "SIGTERM");
			} catch {
				// Already gone: the socket outlived it, and nothing else holds the port.
			}
		}
	}
}

/** A port nothing listens on, taken and released so the daemon can have it. */
function freePort(): number {
	const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } });
	const { port } = server;
	server.stop(true);
	return port;
}

function short(error: unknown): string {
	return (
		String(error instanceof Error ? error.message : error)
			.split("\n")[0]
			?.slice(0, 120) ?? "unknown"
	);
}

process.exit(await main());

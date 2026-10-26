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
import { logPath, readTail, targetOf } from "@adeildo/pi-kit";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { GOES_ALONE } from "@adeildo/pi-remote-client";
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
const MANDATORY: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6, 7]);

/** The steps with a body. The rest are named and not written: a report that says `fail` for them
 * claims a measurement nobody made, and a reader cannot tell that from a step that ran and broke. */
const WRITTEN: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6, 7]);

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
					: lastSaid(context).includes("ask me") && !answeredSince(context)
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
			reports.push({ step: 7, ...(await sentWhileOffline(page, rig)) });
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
		await page.getByTestId("composer").waitFor({ timeout: 30_000 });
		return await carriesTheOpeningsState(page);
	} catch (error) {
		return { ok: false, why: short(error) };
	}
}

/**
 * The page has what the opening computed, before any turn has ended: the session's cost is in the
 * state it keeps. No `cost.changed` has been sent yet (that waits for a turn), so only the opening can
 * have put it there, and a client that does not read the opening's state never has it.
 */
async function carriesTheOpeningsState(page: Page): Promise<Result> {
	const deadline = Date.now() + 20_000;
	let seen = "no cached state";
	while (Date.now() < deadline) {
		seen = await page.evaluate(() => {
			const key = Object.keys(localStorage).find((one) => one.startsWith("pi-remote:session:"));
			const state = JSON.parse(localStorage.getItem(key ?? "") ?? "{}").state ?? {};
			return typeof state.cost?.total === "number" ? "cost" : `no cost (${Object.keys(state)})`;
		});
		if (seen === "cost") return { ok: true };
		await Bun.sleep(200);
	}
	return { ok: false, why: `the page holds no cost the opening carried: ${seen}` };
}

/**
 * A prompt sent from the browser reaches the session and the model answers. The session is idle when
 * the prompt arrives, which is the case #188 fixed: the letter goes in at once instead of waiting for
 * a settle that never comes.
 */
/**
 * A sheet marks the row that is on the way the terminal marks its selected row: a bar in the accent, a
 * pointer before the label, and the label in bold. The permission dial starts on `manual`, so that row
 * is the one marked, and the others carry neither the bar nor the pointer.
 */
async function marksTheChosenOption(page: Page): Promise<Result> {
	try {
		await page.getByRole("button", { name: /^Permission mode: / }).click({ timeout: 20_000 });
		const sheet = page.getByRole("dialog", { name: "Permission mode" });
		await sheet.waitFor({ timeout: 20_000 });
		const row = sheet.getByRole("radio", { checked: true });
		const rows = await sheet.getByRole("radio").count();
		const bars = await sheet.getByTestId("option-bar").count();
		const pointer = (await row.first().textContent({ timeout: 5_000 }))?.includes("\u276F");
		await sheet.getByRole("button", { name: "Close", exact: true }).click({ timeout: 10_000 });
		return rows > 1 && bars === 1 && pointer === true
			? { ok: true }
			: {
					ok: false,
					why: `of ${rows} rows the sheet has ${bars} bars and the chosen one ${pointer ? "has" : "lacks"} its pointer`,
				};
	} catch (error) {
		return { ok: false, why: `the permission dial did not open a sheet (${short(error)})` };
	}
}

/**
 * The model chip opens a sheet of the models the session's registry lists, and the search narrows it.
 * The list comes from the opening, with no event after it, so a chip that opens has read the state
 * the bridge sent. The rig's registry is pi's own and its size depends on the machine's credentials,
 * so the step needs one model at least: it proves the sheet reads the state, a search nothing matches
 * empties it, and clearing the search brings every row back.
 */
async function searchesModels(page: Page): Promise<Result> {
	try {
		// The rig's model is `rig/scripted`. The opening is the only thing that carries it to a page that
		// opens after the session started, so a chip that names it has read the opening.
		const chip = page.getByRole("button", { name: /^Model: scripted/ });
		await chip.waitFor({ timeout: 20_000 });
		await chip.click({ timeout: 20_000 });
		const sheet = page.getByRole("dialog", { name: "Model" });
		await sheet.waitFor({ timeout: 20_000 });
		const all = await sheet.getByRole("radio").count();
		await sheet.getByRole("textbox", { name: "Search models" }).fill("zzzz-no-such-model");
		const none = await sheet.getByRole("radio").count();
		await sheet.getByRole("textbox", { name: "Search models" }).fill("");
		const back = await sheet.getByRole("radio").count();
		await sheet.getByRole("button", { name: "Close", exact: true }).click({ timeout: 10_000 });
		return all >= 1 && none === 0 && back === all
			? { ok: true }
			: {
					ok: false,
					why: `the model sheet listed ${all}, then ${none} for a search nothing matches, then ${back}`,
				};
	} catch (error) {
		return { ok: false, why: `the model chip did not open a sheet (${short(error)})` };
	}
}

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
		const box = page.getByRole("textbox", { name: "Prompt" });
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
		if (entries() > before) {
			// The prompt came from the browser, so the message says "you" and, beside it, where it was typed:
			// the origin is on the message that holds these words, and a message the bridge could not
			// attribute would carry no origin at all.
			const origin = page
				.locator("li.remote-you", { hasText: "say hello from the gate" })
				.locator(".remote-from");
			const marked = Date.now() + 20_000;
			let said = "";
			while (!said.startsWith("from ") && Date.now() < marked) {
				said = (
					(await origin
						.first()
						.textContent({ timeout: 1_000 })
						.catch(() => "")) ?? ""
				).trim();
				if (!said.startsWith("from ")) await Bun.sleep(100);
			}
			if (!said.startsWith("from "))
				return { ok: false, why: `the prompt the browser sent says no origin (read "${said}")` };
			// The label of what the person said wears the theme's accent: the page is light, and pi's light
			// accent is #7459b4. The state carries the name; only the app knows the value.
			const who =
				(await page
					.locator("li.remote-you", { hasText: "say hello from the gate" })
					.locator(".remote-who")
					.first()
					.getAttribute("style")) ?? "";
			if (!who.includes("color: rgb(116, 89, 180)"))
				return {
					ok: false,
					why: `the label of the prompt the browser sent is styled "${who}", not with the accent`,
				};
			const searched = await searchesModels(page);
			return searched.ok ? await marksTheChosenOption(page) : searched;
		}
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
		const box = page.getByRole("textbox", { name: "Prompt" });
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

		// A message only waits while a run is going. Recording both sides here is what tells the
		// failure apart: a run that ended first means the message went in at once, not that the queue
		// is broken.
		const sentWhileBusy = busy();
		const before = rig.session.sessionManager.getBranch().length;
		// The row is told by its id, which the screen carries as the DOM id: an earlier row can still
		// be waiting, and a second row with the same words is the row text cannot tell apart.
		const heldIds = (): Promise<string[]> =>
			page.getByTestId("held-row").evaluateAll((rows) => rows.map((one) => one.id));
		const known = new Set(await heldIds());
		await box.fill("wait for me");
		await page.keyboard.press("Enter");
		let fresh: string | undefined;
		let mostRows = 0;
		const appeared = Date.now() + 90_000;
		while (fresh === undefined && Date.now() < appeared) {
			const ids = await heldIds();
			mostRows = Math.max(mostRows, ids.length);
			fresh = ids.find((id) => id !== "" && !known.has(id));
			if (fresh === undefined) await Bun.sleep(100);
		}
		if (fresh === undefined) {
			const delivered = rig.session.sessionManager.getBranch().length > before;
			return {
				ok: false,
				why: `no queue row (rows before: ${known.size}, most rows seen: ${mostRows}, run going at the send: ${sentWhileBusy}, message delivered: ${delivered})`,
			};
		}
		const row = page.locator(`[data-testid="held-row"][id="${fresh}"]`);
		const said = (await row.getByTestId("held-text").innerText()).trim();

		await row.getByRole("button", { name: "Withdraw", exact: true }).click();
		await row.waitFor({ state: "detached", timeout: 20_000 });
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
		const box = page.getByRole("textbox", { name: "Prompt" });
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

/**
 * Whether a tool already answered since the person last typed. The model asks the question once per
 * prompt: without this it saw the same prompt as the last user message after every tool result and
 * asked again, so the page always had an open question a second after the last one was answered.
 */
function answeredSince(context: { messages: readonly { role?: string }[] }): boolean {
	const lastUser = context.messages.map((one) => one.role).lastIndexOf("user");
	return context.messages.slice(lastUser + 1).some((one) => one.role === "toolResult");
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
 * A command typed with no wire goes out after the reload. The proof is the session's own branch: the
 * line on the screen says it was queued, and the branch says it arrived.
 */
async function sentWhileOffline(page: Page, rig: Rig): Promise<Result> {
	try {
		const before = rig.session.sessionManager.getBranch().length;
		const box = page.getByRole("textbox", { name: "Prompt" });
		await page.context().setOffline(true);
		try {
			await box.click({ timeout: 20_000 });
		} catch {
			const open = await page.getByRole("button", { name: /^Ship it/ }).count();
			const shown = await page.getByTestId("composer").isVisible();
			return {
				ok: false,
				why: `the prompt could not be clicked (question open: ${open > 0}, composer shown: ${shown}, ${await cachedState(page)})`,
			};
		}
		await box.fill("typed while the wire was down");
		await page.keyboard.press("Enter");
		// The device keeps it: the outbox is drawn, and nothing reached the session.
		await page.getByTestId("composer").waitFor({ timeout: 20_000 });
		await Bun.sleep(500);

		await page.context().setOffline(false);
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.getByTestId("composer").waitFor({ timeout: 60_000 });

		const arrived = Date.now() + 60_000;
		while (rig.session.sessionManager.getBranch().length <= before && Date.now() < arrived)
			await Bun.sleep(200);
		if (rig.session.sessionManager.getBranch().length > before) return { ok: true };
		// Where the command stopped tells the two failures apart: still in the device's storage means
		// the reload did not drain the outbox, gone means the client sent it and the session lost it.
		// Four numbers say where it stopped: `ready` and `held` are the queue's own reading of a waiting
		// command (inside the window or past it), `sent` is the connection having taken it, and
		// `received` is the session's log saying the daemon's command arrived. `sent` without
		// `received` is a write that never got there; `received` without an applied command is the
		// session not applying it.
		const kept = await page.evaluate(() => {
			const found: { key: string; id?: string; state?: string; at?: number }[] = [];
			for (let at = 0; at < localStorage.length; at++) {
				const key = localStorage.key(at) ?? "";
				const value = localStorage.getItem(key) ?? "";
				if (!value.includes("typed while the wire was down")) continue;
				const outbox = (
					JSON.parse(value) as {
						outbox?: { id: string; state: string; at: number; data?: { text?: string } }[];
					}
				).outbox;
				const one = outbox?.find(
					(command) => command.data?.text === "typed while the wire was down",
				);
				found.push({ key, id: one?.id, state: one?.state, at: one?.at });
			}
			return found;
		});
		const first = kept[0];
		if (first === undefined)
			return { ok: false, why: "the command left the outbox and never reached the session" };
		const age = first.at === undefined ? undefined : Date.now() - first.at;
		const waiting = first.state === "waiting";
		const manager = rig.session.sessionManager;
		const received =
			first.id !== undefined &&
			readTail(logPath(targetOf(manager as never))).some(
				(event) =>
					event.type === "command.received" && (event.data as { id?: string }).id === first.id,
			);
		return {
			ok: false,
			why: `the command is still in the outbox (state: ${first.state}, ready: ${waiting && age !== undefined && age <= GOES_ALONE}, held: ${waiting && age !== undefined && age > GOES_ALONE}, sent: ${first.state === "sent"}, received: ${received})`,
		};
	} catch (error) {
		return { ok: false, why: short(error) };
	}
}

/**
 * What the page last kept of the session's state, read from the cache it writes after every change:
 * the questions with whether each is closed, and what the state says of the permission mode. It is the
 * state the page draws from, not what the daemon sent, which is the question a failing step cannot
 * answer by itself.
 */
async function cachedState(page: Page): Promise<string> {
	return page.evaluate(() => {
		for (let at = 0; at < localStorage.length; at++) {
			const key = localStorage.key(at) ?? "";
			if (!key.startsWith("pi-remote:session:")) continue;
			const state = (
				JSON.parse(localStorage.getItem(key) ?? "{}") as {
					state?: {
						questions?: Record<string, { closed?: boolean }>;
						permissions?: { serves?: boolean; mode?: string };
					};
				}
			).state;
			const questions = Object.entries(state?.questions ?? {}).map(
				([id, one]) => `${id}${one.closed === true ? ":closed" : ":open"}`,
			);
			return `cache questions=[${questions.join(",")}] serves=${state?.permissions?.serves} mode=${state?.permissions?.mode}`;
		}
		return "no cached session";
	});
}

/**
 * The daemon restarts and a reloaded page draws the session again, from the state the session sends:
 * the mode the person picked, and the question answered in step 5, which stays closed.
 */
async function survivesRestart(page: Page): Promise<Result> {
	try {
		const dial = page.getByRole("button", { name: /^Permission mode: / });
		// A dial that is not on the page yet reads as "not edits", so a slow page is a wait and not a
		// 30-second error that says nothing about which part was missing.
		const isEdits = async (): Promise<boolean> =>
			(
				(await dial.getAttribute("aria-label", { timeout: 1_000 }).catch(() => null)) ?? ""
			).endsWith(": edits");
		await dial.click({ timeout: 20_000 });
		await page.getByRole("radio", { name: "edits", exact: true }).click({ timeout: 20_000 });
		// The chip follows the state, so a mode that sticks is the state having taken it.
		const chosen = Date.now() + 20_000;
		while (!(await isEdits()) && Date.now() < chosen) await Bun.sleep(100);
		if (!(await isEdits())) return { ok: false, why: "the mode never stuck, before any restart" };

		// The daemon goes away, as a restart does.
		const holder = readCurrent(root)?.pid;
		if (holder === undefined) return { ok: false, why: "no daemon to restart" };
		process.kill(holder, "SIGTERM");
		const back = Date.now() + 45_000;
		while (readCurrent(root)?.pid === holder && Date.now() < back) await Bun.sleep(200);
		if (readCurrent(root)?.pid === holder) return { ok: false, why: "no daemon came back" };

		await page.reload({ waitUntil: "domcontentloaded" });
		await page.getByTestId("composer").waitFor({ timeout: 60_000 });
		// The page draws from the state the session sends, and that state arrives when the bridge
		// registers with the new daemon: the daemon pushes it to whoever was waiting.
		// Both halves wait the same way: the mode and the closed question arrive with the same state,
		// so reading one of them once is a race the test loses now and then.
		const settled = Date.now() + 60_000;
		const stillOpen = async (): Promise<boolean> =>
			(await page.getByRole("button", { name: /^Ship it/ }).count()) > 0;
		while ((!(await isEdits()) || (await stillOpen())) && Date.now() < settled)
			await Bun.sleep(200);
		const mode = await isEdits();
		const closed = !(await stillOpen());
		return mode && closed
			? { ok: true }
			: {
					ok: false,
					why: `mode back=${mode}, question closed=${closed}, dials on the page=${await dial.count()}, composers=${await page.getByTestId("composer").count()}, ${await cachedState(page)}`,
				};
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

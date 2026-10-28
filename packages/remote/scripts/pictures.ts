// The remote's pictures for the READMEs: a real daemon and a real pi session with a scripted model,
// driven from a phone-sized browser. Run it with `bun run docs:remote` from the repository's root.
// The pictures change with every run (times, names), so the docs check does not compare them.
/* oxlint-disable no-await-in-loop -- the steps are a story, told in order */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import piPermission from "@adeildo/pi-ask-permission";
import piQuestions, { TOOL_NAME } from "@adeildo/pi-ask-questions";
import { board, createApp, names } from "@adeildo/pi-kit";
import { createRig, type Rig } from "@adeildo/pi-kit/rig";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { $ } from "bun";
import { chromium, type Page } from "playwright-core";

import { requestLink } from "../src/cli/open.ts";
import piRemote from "../src/index.ts";
import { readCurrent } from "../src/launcher.ts";
import { daemonPaths } from "../src/places.ts";

const ASSETS = resolve(import.meta.dir, "..", "assets");
const PHONE = { width: 390, height: 844 };

/** The board and the names, as the harness loads them. */
function boardAndNames(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(names()).use(board).build();
}

interface Said {
	role?: string;
	content?: unknown;
}

function lastPrompt(messages: readonly Said[]): string {
	const user = messages.findLast((one) => one.role === "user");
	const content = user?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content.map((part: { text?: string }) => part.text ?? "").join("");
	return "";
}

/** How many tools answered since the last prompt: the step of the story the model is at. */
function stepOf(messages: readonly Said[]): number {
	const last = messages.map((one) => one.role).lastIndexOf("user");
	return messages.slice(last + 1).filter((one) => one.role === "toolResult").length;
}

const ASK_TESTS = "Add a --dry-run flag to the release script and run its tests";
const ASK_PUSH = "Push it";

/** A small project, so the tests the model runs are real tests that pass. */
function project(): string {
	// A fixed name, since the page shows the folder.
	const cwd = join(mkdtempSync(join(tmpdir(), "pi-pictures-")), "acme-api");
	mkdirSync(join(cwd, "scripts"), { recursive: true });
	writeFileSync(
		join(cwd, "scripts", "release.ts"),
		'export function plan(dryRun: boolean): string[] {\n\treturn dryRun ? ["build", "tag (dry run)"] : ["build", "tag", "publish"];\n}\n',
	);
	writeFileSync(
		join(cwd, "scripts", "release.test.ts"),
		[
			'import { expect, test } from "bun:test";',
			'import { plan } from "./release.ts";',
			'test("a dry run publishes nothing", () => expect(plan(true)).not.toContain("publish"));',
			'test("a real run publishes", () => expect(plan(false)).toContain("publish"));',
			'test("both runs build first", () => expect(plan(true)[0]).toBe("build"));',
			"",
		].join("\n"),
	);
	return cwd;
}

async function main(): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "pi-remote-pictures-"));
	process.env.PI_REMOTE_DIR = root;
	process.env.PI_REMOTE_SHARE = "1";
	const cwd = project();
	let rig: Rig | undefined;
	const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
	try {
		rig = await createRig({
			extensions: [piRemote, piQuestions, piPermission, boardAndNames],
			cwd,
			model: { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
			tokensPerSecond: 80,
			settings: { remote: { port: 7899 } },
			answer: (context) => {
				const messages = context.messages as readonly Said[];
				const said = lastPrompt(messages);
				const step = stepOf(messages);
				if (said.includes("dry-run")) {
					if (step === 0)
						return fauxAssistantMessage([
							fauxToolCall("board", {
								op: "add",
								title: "Release script takes --dry-run",
								column: "doing",
							}),
						]);
					if (step === 1)
						return fauxAssistantMessage([
							fauxToolCall("bash", { command: "bun test scripts/release.test.ts" }),
						]);
					if (step === 2)
						return fauxAssistantMessage([
							fauxToolCall("board", {
								op: "move",
								id: "c1",
								column: "done",
								result: "--dry-run plans without publishing; 3 tests pass",
							}),
						]);
					return fauxAssistantMessage(
						"Done. `scripts/release.ts` takes `--dry-run`: it builds and tags, and publishes nothing.\n\nThe three tests pass.",
					);
				}
				if (said.includes(ASK_PUSH) && step === 0)
					return fauxAssistantMessage([
						fauxToolCall(TOOL_NAME, {
							questions: [
								{
									header: "Branch",
									question: "Where should the --dry-run change go?",
									options: [
										{
											label: "A pull request (Recommended)",
											description: "A branch and a PR, so someone reviews it first.",
										},
										{ label: "Straight to main", description: "As the last releases did." },
									],
								},
							],
						}),
					]);
				return fauxAssistantMessage("Pushed to a branch, and the pull request is open.");
			},
		});

		const link = await waitForLink(root);
		const context = await browser.newContext({
			viewport: PHONE,
			deviceScaleFactor: 2,
			colorScheme: "dark",
		});
		const page = await context.newPage();
		await page.goto(link);
		await page.locator("a[href*='/session/']").first().waitFor({ timeout: 30_000 });
		await page.locator("a[href*='/session/']").first().click();
		await page.getByTestId("composer").waitFor({ timeout: 30_000 });

		await send(page, ASK_TESTS);
		// The card first, which the permission asks about too, then the tests: that ask is the picture.
		await approve(page, "board wants to run");
		await asking(page, "bash wants to run").waitFor({ timeout: 60_000 });
		await settle(page);
		await shot(page, "phone-ask");

		// The list, with the session waiting on you.
		const list = await context.newPage();
		await list.goto(new URL("/", page.url()).href);
		await list.locator("a[href*='/session/']").first().waitFor({ timeout: 30_000 });
		await settle(list);
		await shot(list, "phone-list");
		await list.close();

		await approve(page, "bash wants to run");
		await approve(page, "board wants to run");
		await page.getByText("The three tests pass.").waitFor({ timeout: 90_000 });
		await settle(page);
		await shot(page, "phone-session");

		await send(page, ASK_PUSH);
		await page.getByRole("button", { name: /^A pull request/ }).waitFor({ timeout: 90_000 });
		await page.getByRole("button", { name: /^A pull request/ }).click();
		await settle(page);
		await shot(page, "phone-question");
	} finally {
		await browser.close();
		rig?.dispose();
		const pid = readCurrent(root)?.pid;
		if (pid !== undefined) {
			try {
				process.kill(pid);
			} catch {
				// Already gone.
			}
		}
		rmSync(root, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
	await strip();
}

/** Answers yes to the ask that names `what`, once it is on the screen. */
async function approve(page: Page, what: string): Promise<void> {
	try {
		await asking(page, what).waitFor({ timeout: 60_000 });
	} catch (error) {
		await page.screenshot({ path: join(tmpdir(), "pictures-failed.png") });
		console.error((await page.locator("body").innerText()).slice(0, 1500));
		throw error;
	}
	await page
		.getByRole("button", { name: /^yes\b/i })
		.first()
		.click();
	await page.getByRole("button", { name: /^Send/ }).last().click();
	await asking(page, what).waitFor({ state: "detached", timeout: 30_000 });
}

/** The ask on the screen, by its heading: the list beside it repeats the words. */
function asking(page: Page, what: string) {
	return page.getByRole("heading", { name: new RegExp(`^${what}`) });
}

async function send(page: Page, text: string): Promise<void> {
	const box = page.getByRole("textbox", { name: "Prompt" });
	await box.click({ timeout: 20_000 });
	await box.fill(text);
	await page.getByRole("button", { name: "Send", exact: true }).click({ timeout: 20_000 });
}

/** Long enough for an animation to end and the last event to draw. */
async function settle(page: Page): Promise<void> {
	await page.waitForTimeout(1_200);
}

async function shot(page: Page, name: string): Promise<void> {
	mkdirSync(ASSETS, { recursive: true });
	await page.screenshot({ path: join(ASSETS, `${name}.png`) });
	console.log(`drew packages/remote/assets/${name}.png`);
}

async function waitForLink(root: string): Promise<string> {
	const { socket } = daemonPaths(root);
	const deadline = Date.now() + 30_000;
	for (;;) {
		const link = await requestLink(socket);
		if ("url" in link) return link.url;
		if (Date.now() > deadline) throw new Error(`no daemon: ${link.reason}`);
		await Bun.sleep(100);
	}
}

/** The four screens side by side, as one picture a README can show at its width. */
async function strip(): Promise<void> {
	const screens = ["phone-list", "phone-ask", "phone-session", "phone-question"];
	const width = 300;
	const height = Math.round((width * PHONE.height) / PHONE.width);
	const gap = 28;
	const total = screens.length * width + (screens.length - 1) * gap;
	const images: string[] = [];
	for (const [index, name] of screens.entries()) {
		const data = Buffer.from(await Bun.file(join(ASSETS, `${name}.png`)).arrayBuffer()).toString(
			"base64",
		);
		const x = index * (width + gap);
		images.push(
			`<clipPath id="c${index}"><rect x="${x}" y="0" width="${width}" height="${height}" rx="28"/></clipPath>`,
			`<image x="${x}" y="0" width="${width}" height="${height}" clip-path="url(#c${index})" href="data:image/png;base64,${data}"/>`,
			`<rect x="${x + 0.5}" y="0.5" width="${width - 1}" height="${height - 1}" rx="28" fill="none" stroke="#3a3a44"/>`,
		);
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}">${images.join("")}</svg>`;
	const png = await $`rsvg-convert --zoom 2 - < ${new Response(svg)}`.arrayBuffer();
	writeFileSync(join(ASSETS, "phones.png"), new Uint8Array(png));
	console.log("drew packages/remote/assets/phones.png");
}

await main();
process.exit(0);

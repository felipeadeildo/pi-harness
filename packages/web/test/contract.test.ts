import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyDefaults, webSearchConfigPath } from "../src/config.ts";
import { WEB_DEFAULTS } from "../src/defaults.ts";

const PROBE = join(import.meta.dir, "probe.ts");
const made: string[] = [];

function folder(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-web-contract-"));
	made.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Probe {
	path: string;
	searchRouting: unknown;
	fetchError: string | null;
	answerAsked: string[];
	answer: string;
}

function probe(env: Record<string, string | undefined>): Probe {
	const run = Bun.spawnSync(["bun", PROBE], {
		env: { PATH: process.env.PATH, HOME: env.HOME ?? folder(), ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
	return JSON.parse(run.stdout.toString().trim().split("\n").at(-1) ?? "{}") as Probe;
}

/** Lets the probe fetch its own page on 127.0.0.1, which pi-web-access refuses by default. */
function defaultsIn(agentDir: string): void {
	writeFileSync(
		join(agentDir, "web-search.json"),
		JSON.stringify({ ssrf: { allowRanges: ["127.0.0.0/8"] } }),
	);
	applyDefaults(join(agentDir, "web-search.json"), join(agentDir, "decided.json"), {
		provider: "deepseek",
		model: "deepseek-flash",
	});
}

describe("the pinned pi-web-access takes the harness's config", () => {
	test("its own checks accept the routing, and read the answer model the harness chose", () => {
		const agentDir = folder();
		defaultsIn(agentDir);
		const seen = probe({ PI_CODING_AGENT_DIR: agentDir });
		expect(seen.searchRouting).toEqual(
			WEB_DEFAULTS.find((one) => one.key === "searchRouting")?.value,
		);
		expect(seen.fetchError ?? "").not.toContain("fetchRouting");
		expect(seen.answerAsked).toEqual(["deepseek/deepseek-flash"]);
	});

	test("the probe sees a routing it would refuse, so a pass above means something", () => {
		const agentDir = folder();
		defaultsIn(agentDir);
		const path = join(agentDir, "web-search.json");
		const config = JSON.parse(readFileSync(path, "utf8"));
		config.fetchRouting.providers.push("nobody");
		writeFileSync(path, JSON.stringify(config));
		expect(probe({ PI_CODING_AGENT_DIR: agentDir }).fetchError).toContain("fetchRouting.providers");
	});

	test("the harness writes the file pi-web-access reads, wherever that is", () => {
		const home = folder();
		const xdg = join(home, "xdg");
		const cases: Record<string, string | undefined>[] = [
			{ HOME: home },
			{ HOME: home, XDG_CONFIG_HOME: xdg },
			{ HOME: home, PI_CODING_AGENT_DIR: join(home, "agent-dir") },
		];
		for (const env of cases) {
			const ours = webSearchConfigPath(env, home);
			expect(probe(env).path).toBe(ours);
		}
		mkdirSync(join(home, ".pi"), { recursive: true });
		writeFileSync(join(home, ".pi", "web-search.json"), "{}");
		expect(probe({ HOME: home }).path).toBe(webSearchConfigPath({}, home));
		expect(webSearchConfigPath({}, home)).toBe(join(home, ".pi", "web-search.json"));
	});
});

test("the dependency is pinned to one version, the one installed", () => {
	const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
	const pinned: string = manifest.dependencies["pi-web-access"];
	expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
	const installed = JSON.parse(readFileSync(require.resolve("pi-web-access/package.json"), "utf8"));
	expect(installed.version).toBe(pinned);
});

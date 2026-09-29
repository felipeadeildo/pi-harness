import { expect, test } from "bun:test";

import {
	VERSION,
	type ReadonlyFooterDataProvider,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { StatuslineFooter, type StatuslineSource } from "../src/footer.ts";
import { PRESETS } from "../src/presets.ts";
import { emptyData, type SessionData } from "../src/segments.ts";

function tui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function footerData(
	branch: string | null,
	statuses: Record<string, string> = {},
): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => branch,
		getExtensionStatuses: () => new Map(Object.entries(statuses)),
		onBranchChange: () => () => {},
		getAvailableProviderCount: () => 1,
	} as unknown as ReadonlyFooterDataProvider;
}

const model: SessionData["model"] = {
	id: "claude-opus-5-5",
	name: "Opus 5.5",
	provider: "anthropic",
	reasoning: true,
};

function source(
	overrides: Partial<SessionData> = {},
	preset: "full" | "compact" | "minimal" = "full",
) {
	const repaints: (() => void)[] = [];
	const value: StatuslineSource = {
		data: (input) => ({
			...emptyData(),
			cwd: "/home/ada/Projects/pi-harness",
			home: "/home/ada",
			branch: input.branch,
			host: "ghost",
			model,
			thinking: "high",
			context: { percent: 43.1, tokens: 431_000, contextWindow: 1_000_000 },
			totals: { input: 2400, output: 347, cacheRead: 0, cacheWrite: 0, cost: 0.139 },
			rate: 42,
			firstTokenMs: 320,
			generationMs: 30_000,
			turn: {
				running: false,
				elapsedMs: 137_000,
				usage: { input: 427_000, output: 66_000, cacheRead: 22_000_000, cacheWrite: 0, cost: 0.44 },
			},
			statuses: input.statuses,
			...overrides,
		}),
		options: () => ({ pathLength: 40, statuses: true, gauge: true, icons: false }),
		preset: () => preset,
		separator: () => "bar",
		attach: (repaint) => void repaints.push(repaint),
	};
	return { value, repaints };
}

function render(
	overrides: Partial<SessionData> = {},
	preset: "full" | "compact" | "minimal" = "full",
): string[] {
	const { value } = source(overrides, preset);
	return new StatuslineFooter(
		tui(),
		theme,
		footerData("main", { perm: "auto · anywhere" }),
		value,
	).render(200);
}

test("the full footer is the answer, then where, then who and what it cost, then the other packages", () => {
	const lines = render();

	expect(lines).toHaveLength(4);
	expect(lines[0]).toBe("42 tok/s · 320ms · 2m 17s · 22.5M (U 427k + R 22.0M) · 66k · $0.02/M");
	expect(lines[1]).toBe(
		`~/Projects/pi-harness · main │ ghost · v${VERSION} │ 43.1% ▓▓▓░░░░░ 431k/1.0M`,
	);
	expect(lines[2]).toBe("anthropic │ Opus 5.5 · high │ ↑2.4k · ↓347 · $0.139 · avg 12 tok/s");
	expect(lines[3]).toBe("auto · anywhere");
});

test("with no answer yet the first line has nothing to say", () => {
	const lines = render({ turn: undefined, rate: undefined, firstTokenMs: undefined });

	expect(lines).toHaveLength(3);
	expect(lines[0]).toContain("~/Projects/pi-harness");
});

test("the statuses line disappears when nothing reports a status", () => {
	const { value } = source();
	const lines = new StatuslineFooter(tui(), theme, footerData(null), value).render(200);

	expect(lines).toHaveLength(3);
	expect(lines.join(" ")).not.toContain("auto");
});

test("the compact preset keeps the answer, the session and the statuses", () => {
	const lines = render({}, "compact");

	expect(lines).toHaveLength(3);
	expect(lines[0]).toContain("42 tok/s");
	expect(lines[1]).toContain("43.1%");
	expect(lines[2]).toBe("auto · anywhere");
});

test("a narrow terminal gives up the groups in the cut order, keeping the model", () => {
	const { value } = source();
	const lines = new StatuslineFooter(tui(), theme, footerData("main"), value).render(20);

	expect(lines.join(" ")).toContain("Opus 5.5");
	expect(lines.join(" ")).not.toContain("anthropic");
});

test("the feature can ask for a repaint, and the component cleans up", () => {
	let watched = 0;
	let unwatched = 0;
	const data = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		onBranchChange: () => {
			watched++;
			return () => void unwatched++;
		},
		getAvailableProviderCount: () => 1,
	} as unknown as ReadonlyFooterDataProvider;

	const { value, repaints } = source();
	const component = new StatuslineFooter(tui(), theme, data, value);
	expect(watched).toBe(1);
	expect(repaints).toHaveLength(1);

	component.dispose();
	expect(unwatched).toBe(1);
});

test("every preset renders without a branch, a model, a context or an answer", () => {
	for (const preset of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
		const { value } = source(
			{ model: undefined, thinking: undefined, context: undefined, turn: undefined },
			preset,
		);
		const lines = new StatuslineFooter(tui(), theme, footerData(null), value).render(200);
		expect(lines.length).toBeGreaterThan(0);
	}
});

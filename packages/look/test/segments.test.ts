import { describe, expect, test } from "bun:test";

import { ASCII, NERD } from "../src/render/glyphs.ts";
import { PLAIN, type Paint } from "../src/render/paint.ts";
import {
	claimedStatuses,
	isSegmentId,
	renderSegments,
	SEGMENT_IDS,
	type SegmentId,
} from "../src/render/segments.ts";
import { snapshot } from "./helpers.ts";

const options = { pathLength: 40, gaugeCells: 8, claimed: new Set<string>(), labels: false };

function render(
	ids: SegmentId[],
	data = snapshot(),
	extra: Partial<typeof options> = {},
	paint: Paint = PLAIN,
) {
	return renderSegments(ids, {
		snapshot: data,
		glyphs: ASCII,
		paint,
		options: { ...options, ...extra },
	});
}

function text(ids: SegmentId[], data = snapshot(), extra: Partial<typeof options> = {}) {
	return render(ids, data, extra).map((piece) => piece.text);
}

describe("segments", () => {
	test("the model comes after its provider, and the short form keeps only the name", () => {
		const [piece] = render(["model"]);
		expect(piece?.text).toBe("Anthropic/Opus 5.5");
		expect(piece?.compact).toBe("Opus 5.5");
	});

	test("the effort is a meter of six levels, filled up to the one in use", () => {
		expect(text(["effort"])).toEqual(["|||||| high"]);
		const painted = renderSegments(["effort"], {
			snapshot: snapshot({ thinking: "medium" }),
			glyphs: NERD,
			paint: { ...PLAIN, effort: (level, bar) => `<${level}>${bar}`, dim: (bar) => `.${bar}` },
			options,
		});
		expect(painted[0]?.text).toBe("<minimal>▂<low>▃<medium>▄.▅.▆.▇ <medium>medium");
	});

	test("a model that does not reason has no effort to show", () => {
		const data = snapshot({ model: { name: "Flash", provider: "Google", reasoning: false } });
		expect(text(["effort"], data)).toEqual([]);
	});

	test("the branch carries its distance and what changed", () => {
		const data = snapshot({
			git: {
				ahead: 1,
				behind: 22,
				staged: 2,
				modified: 3,
				untracked: 1,
				conflicted: 0,
				stashed: 0,
			},
		});
		const [piece] = render(["branch"], data);
		expect(piece?.text).toBe("main ^1 v22 +2 ~3 ?1");
		expect(piece?.compact).toBe("main*");
	});

	test("the context shows the gauge, and its short form only the percentage", () => {
		const [piece] = render(["context"]);
		expect(piece?.text).toBe("ctx 43% ###----- 431k/1M");
		expect(piece?.compact).toBe("ctx 43%");
		expect(text(["context"], snapshot(), { gaugeCells: 0 })).toEqual(["ctx 43% 431k/1M"]);
	});

	test("speed shows received and sent, marking an estimate", () => {
		const data = snapshot({
			request: {
				streaming: true,
				waiting: false,
				elapsedMs: 4_000,
				firstTokenMs: 1_700,
				decode: 906,
				prefill: 48_000,
				usage: { input: 2, output: 230, cacheRead: 80_000, cacheWrite: 1_300, cost: 0.027 },
				estimated: true,
			},
		});
		expect(text(["speed", "wait", "request", "costRate"], data)).toEqual([
			"v 906 ^ 48k tok/s",
			"ttft  1.7s",
			"^ 81k (R 80k W1.3k) v 230",
			"$0.33 per Mtok",
		]);
	});

	test("the wait counts up while the first token has not arrived", () => {
		const data = snapshot({
			request: {
				streaming: true,
				waiting: true,
				elapsedMs: 3_400,
				firstTokenMs: undefined,
				decode: undefined,
				prefill: undefined,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				estimated: true,
			},
		});
		expect(text(["speed", "wait"], data)).toEqual(["v   – ^   – tok/s", "ttft  3.4s"]);
	});

	test("the run is a stopwatch, which keeps its shape as it counts", () => {
		const run = (elapsedMs: number, requests: number) =>
			text(["elapsed"], snapshot({ run: { running: true, elapsedMs, requests } }));
		expect(run(12_300, 3)).toEqual(["0:12 ×3"]);
		expect(run(3_725_000, 1)).toEqual(["1:02:05"]);
	});

	test("session speeds, cost and cache", () => {
		const data = snapshot({
			averages: { decode: 290, prefill: 31_000 },
			cacheHit: 98.4,
			subscription: true,
		});
		expect(text(["average", "cost", "cache", "tokens"], data)).toEqual([
			"avg v290 ^31k tok/s",
			"$0.139 sub",
			"R 98%",
			// Sent is the whole prompt, cache included: 2.4k fresh plus 83k read.
			"^85k v347",
		]);
	});

	test("a status placed on its own leaves the shared list", () => {
		const statuses = new Map([
			["pi-ask-permission:mode", "⏵⏵ auto · anywhere"],
			["pi-memory", "mem 12"],
		]);
		const data = snapshot({ statuses });
		const claimed = claimedStatuses([["status:pi-ask-permission:mode", "model"], ["statuses"]]);
		expect([...claimed]).toEqual(["pi-ask-permission:mode"]);
		expect(text(["status:pi-ask-permission:mode"], data, { claimed })).toEqual([
			"⏵⏵ auto · anywhere",
		]);
		expect(text(["statuses"], data, { claimed })).toEqual([">> mem 12"]);
		expect(text(["status:missing"], data)).toEqual([]);
	});

	test("ids are the built-in ones or a status key", () => {
		expect(isSegmentId("model")).toBe(true);
		expect(isSegmentId("status:pi-ask-permission:mode")).toBe(true);
		expect(isSegmentId("status:")).toBe(false);
		expect(isSegmentId("nope")).toBe(false);
	});

	test("every segment renders against an empty session without throwing", () => {
		const empty = snapshot({ model: undefined, context: undefined, branch: null, cwd: "" });
		expect(() => render([...SEGMENT_IDS], empty)).not.toThrow();
	});
});

const request = (decode: number | undefined, firstTokenMs: number | undefined, output: number) =>
	snapshot({
		request: {
			streaming: true,
			waiting: firstTokenMs === undefined,
			elapsedMs: 900,
			firstTokenMs,
			decode,
			prefill: firstTokenMs === undefined ? undefined : 48_000,
			usage: { input: 2, output, cacheRead: 80_000, cacheWrite: 0, cost: 0 },
			estimated: false,
		},
		run: { running: true, elapsedMs: 9_000, requests: 1 },
	});

describe("stable widths", () => {
	test("the strip keeps its width while the numbers tick", () => {
		const ids: SegmentId[] = ["speed", "wait", "elapsed", "request"];
		const width = (data = snapshot()) => render(ids, data).map((piece) => piece.text.length);
		const waiting = width(request(undefined, undefined, 0));
		expect(width(request(9.8, 1_700, 12))).toEqual(waiting);
		expect(width(request(114, 1_700, 699))).toEqual(waiting);
		expect(width(request(2_800, 1_700, 1_200))).toEqual(waiting);
	});

	test("what is not known yet shows as a dash, so nothing appears in the middle later", () => {
		expect(text(["speed", "wait"], request(undefined, undefined, 0))).toEqual([
			"v   – ^   – tok/s",
			"ttft 900ms",
		]);
	});
});

describe("labels", () => {
	test("say what each number is, after it, the way it reads", () => {
		const last = {
			streaming: false,
			waiting: false,
			elapsedMs: 8_000,
			firstTokenMs: 1_400,
			decode: 31,
			prefill: 59_000,
			usage: { input: 1_200, output: 230, cacheRead: 80_000, cacheWrite: 1_300, cost: 0.06 },
			estimated: false,
		};
		const data = snapshot({
			last,
			run: { running: false, elapsedMs: 8_000, requests: 2 },
			cacheHit: 97,
		});
		expect(text(["elapsed", "last", "tokens", "cache", "context"], data, { labels: true })).toEqual(
			[
				"0:08 · 2 calls",
				"last call 1.4s wait · v31 tok/s",
				"^85k in v347 out",
				"R 97% cached",
				"ctx 43% ###----- 431k/1M",
			],
		);
	});

	test("a cache that was only just written is new, not a miss", () => {
		expect(
			text(["cache"], snapshot({ cacheHit: 0, cacheWarming: true }), { labels: true }),
		).toEqual(["R cache new"]);
	});

	test("no call has finished yet, nothing to say about the last one", () => {
		expect(text(["last"], snapshot())).toEqual([]);
	});
});

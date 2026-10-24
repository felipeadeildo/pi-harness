import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	claimWord,
	claims,
	drawWord,
	readClaim,
	releaseWord,
	RESERVED_MS,
	wordOf,
} from "../src/names/claim.ts";

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-names-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const at = 1_000_000;
/** A world where only the session called "dead" has stopped. */
const aliveButDead = (session: string) => session !== "dead";
const claiming = (extra = 0) => ({ dir, now: at + extra, random: () => 0 });

describe("the claim of a word", () => {
	test("two sessions draw different words", () => {
		const first = drawWord(claiming(), ["otter", "quokka"], "s1", "host");
		const second = drawWord(claiming(), ["otter", "quokka"], "s2", "host");

		expect(first?.word).toBe("quokka");
		expect(second?.word).toBe("otter");
		expect(
			claims(dir)
				.map((claim) => claim.word)
				.toSorted(),
		).toEqual(["otter", "quokka"]);
	});

	test("a resumed session gets its word back, before and inside the reservation", () => {
		expect(drawWord(claiming(), ["otter"], "s1", "host")?.word).toBe("otter");
		expect(drawWord(claiming(1000), ["otter"], "s1", "host")?.word).toBe("otter");

		releaseWord(dir, "otter", "s1", at + 2000);
		expect(drawWord(claiming(2000 + RESERVED_MS - 1), ["otter"], "s1", "host")?.word).toBe("otter");
		expect(readClaim(dir, "otter")?.released).toBeUndefined();
	});

	test("a word a session let go waits for the reservation before it is drawn again", () => {
		claimWord(claiming(), "otter", "s1", "host");
		releaseWord(dir, "otter", "s1", at);

		expect(drawWord(claiming(RESERVED_MS - 1), ["otter"], "s2", "host")?.word).toBe("otter-2");
		expect(drawWord(claiming(RESERVED_MS), ["otter"], "s3", "host")?.word).toBe("otter");
	});

	test("the word of a session that crashed comes back", () => {
		claimWord(claiming(), "otter", "dead", "host");
		expect(drawWord({ ...claiming(), lives: aliveButDead }, ["otter"], "s2", "host")?.word).toBe(
			"otter",
		);
	});

	test("a file that cannot be read does not block the word", () => {
		claimWord(claiming(), "otter", "s1", "host");
		writeFileSync(join(dir, "otter.json"), "{not json");

		expect(drawWord(claiming(), ["otter"], "s2", "host")?.word).toBe("otter");
	});

	test("with every word held, the draw adds a number once and keeps it", () => {
		claimWord(claiming(), "otter", "s1", "host");
		claimWord(claiming(), "quokka", "s2", "host");

		const third = drawWord(claiming(), ["otter", "quokka"], "s3", "host");
		expect(third?.word).toMatch(/^(otter|quokka)-\d+$/);
		expect(drawWord(claiming(), ["otter", "quokka"], "s3", "host")?.word).toBe(third?.word);
	});

	test("a session cannot release a word it does not hold", () => {
		claimWord(claiming(), "otter", "s1", "host");
		releaseWord(dir, "otter", "s2", at);

		expect(readClaim(dir, "otter")?.released).toBeUndefined();
	});

	test("a folder that cannot take a claim leaves the draw empty instead of throwing", () => {
		const blocked = join(dir, "blocked");
		writeFileSync(blocked, "not a folder");

		expect(drawWord({ dir: join(blocked, "names") }, ["otter"], "s1", "host")).toBeUndefined();
	});

	test("two processes drawing at the same time take different words", async () => {
		const module = join(import.meta.dir, "..", "src", "names", "claim.ts");
		const script = `import { drawWord } from ${JSON.stringify(module)};
console.log(drawWord({ dir: process.env.DIR, random: () => 0 }, ["otter", "quokka"], process.env.SESSION, "host")?.word ?? "none");`;
		const draw = (session: string) =>
			Bun.spawn(["bun", "-e", script], {
				env: { ...process.env, DIR: dir, SESSION: session },
				stdout: "pipe",
			}).stdout.text();
		const words = (await Promise.all([draw("a"), draw("b")])).map((text) => text.trim());

		expect(words.toSorted()).toEqual(["otter", "quokka"]);
	});

	test("many processes reclaiming the same stale claims never share a word", async () => {
		const count = 50;
		for (let index = 0; index < count; index++) {
			writeFileSync(
				join(dir, `w${index}.json`),
				`${JSON.stringify({ word: `w${index}`, session: "dead", machine: "m", at: 1 })}\n`,
			);
		}
		const worker = join(import.meta.dir, "names-claim-worker.ts");
		const startAt = Date.now() + 500;
		const draw = (session: string) =>
			Bun.spawn(["bun", worker, dir, session, String(count), String(startAt)], {
				stdout: "pipe",
				stderr: "inherit",
			}).stdout.text();
		const lists = (await Promise.all(["p1", "p2", "p3", "p4"].map(draw))).map(
			(text) => JSON.parse(text) as string[],
		);
		const owners = new Map<string, number>();
		for (const list of lists)
			for (const word of list) owners.set(word, (owners.get(word) ?? 0) + 1);

		expect([...owners.values()].filter((owners) => owners > 1)).toEqual([]);
		expect(owners.size).toBe(count);
	});

	test("wordOf finds what the session holds or may still reclaim", () => {
		claimWord(claiming(), "otter", "s1", "host");
		expect(wordOf(dir, "s1", at)).toBe("otter");

		releaseWord(dir, "otter", "s1", at);
		expect(wordOf(dir, "s1", at + RESERVED_MS - 1)).toBe("otter");
		expect(wordOf(dir, "s1", at + RESERVED_MS)).toBeUndefined();
	});
});

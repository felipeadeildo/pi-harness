// One file per word: the claim is the file, and `wx` is the lock. A session that crashes leaves its
// claim behind; the draw judges it against presence, so the word comes back instead of staying lost.
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { isObject } from "../decode.ts";

/** How long a word waits after its session let it go, so a resumed session gets it back. */
export const RESERVED_MS = 7 * 24 * 60 * 60 * 1000;
/** The suffixes the draw tries when every word is held, before it gives up. */
const CROWD = 99;

/** A word one session holds, or held until it let it go. */
export interface Claim {
	word: string;
	session: string;
	machine: string;
	/** When this session took the word. */
	at: number;
	/** When the session let it go; absent while it holds it. */
	released?: number;
}

/** Where the claims live, and the three things the draw needs to know. */
export interface Claiming {
	/** The folder of claim files, one per word. */
	dir: string;
	/** The clock; tests move it. */
	now?: number;
	/** Whether the session of a claim still runs. Defaults to true, which keeps every claim. */
	lives?: (session: string) => boolean;
	/** The draw's source of chance. */
	random?: () => number;
}

/** The claim of `word`, or undefined when nobody holds it or its file makes no sense. */
export function readClaim(dir: string, word: string): Claim | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(pathOf(dir, word), "utf8"));
		if (!isObject(value)) return undefined;
		const { word: held, session, machine, at, released } = value;
		if (typeof held !== "string" || typeof session !== "string" || typeof machine !== "string")
			return undefined;
		if (typeof at !== "number" || (released !== undefined && typeof released !== "number"))
			return undefined;
		// The file's name is the word; a file that says another thing was written by something else.
		if (held !== word) return undefined;
		return { word: held, session, machine, at, ...(released === undefined ? {} : { released }) };
	} catch {
		return undefined;
	}
}

/** Every claim in the folder, oldest first. A file that makes no sense is left out, not fixed. */
export function claims(dir: string): Claim[] {
	let names: string[];
	try {
		names = readdirSync(dir).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
	return names
		.flatMap((name) => {
			const claim = readClaim(dir, name.slice(0, -".json".length));
			return claim === undefined ? [] : [claim];
		})
		.toSorted((a, b) => a.at - b.at || a.word.localeCompare(b.word));
}

/**
 * The word a session holds now, or let go less than the reservation ago, so a resumed session keeps
 * the handle it had.
 */
export function wordOf(dir: string, session: string, now = Date.now()): string | undefined {
	return claims(dir).find(
		(claim) =>
			claim.session === session &&
			(claim.released === undefined || now - claim.released < RESERVED_MS),
	)?.word;
}

/**
 * Takes `word` for `session`, or says it is taken. New words go through `openSync(..., "wx")`, which
 * fails when the file exists; a claim of a session that no longer runs, a claim reserved long enough
 * ago, and a file that cannot be read are the only ones replaced, so a live session never loses its
 * word. The whole path is synchronous: two draws in one process take turns, never both create.
 */
export function claimWord(
	claiming: Claiming,
	word: string,
	session: string,
	machine: string,
): boolean {
	if (!/^[a-z][a-z0-9-]*$/.test(word)) throw new Error(`not a word a handle may hold: ${word}`);
	const { dir } = claiming;
	const now = claiming.now ?? Date.now();
	mkdirSync(dir, { recursive: true });
	if (takeFile(pathOf(dir, word), { word, session, machine, at: now }) !== "exists") return true;

	const held = readClaim(dir, word);
	const ours = held?.session === session;
	if (ours) {
		// A resumed session keeps the claim, with the machine and the time it came back; a word it
		// had let go is taken back.
		writeAtomically(pathOf(dir, word), { ...held, machine, at: now, released: undefined });
		return true;
	}
	const expired = held?.released !== undefined && now - held.released >= RESERVED_MS;
	const crashed =
		held !== undefined &&
		held.machine === machine &&
		held.released === undefined &&
		!(claiming.lives ?? (() => true))(held.session);
	const broken = held === undefined;
	if (!expired && !crashed && !broken) return false;
	// The stale file goes before `wx` is tried again. Two reclaimers can race here; the file keeps
	// the claim of whoever creates it last, and the other session draws another word.
	rmSync(pathOf(dir, word), { force: true });
	return takeFile(pathOf(dir, word), { word, session, machine, at: now }) !== "exists";
}

/** Lets the word go, keeping the claim for the reservation window. A session cannot release another's. */
export function releaseWord(dir: string, word: string, session: string, now = Date.now()): void {
	const held = readClaim(dir, word);
	if (held === undefined || held.session !== session || held.released !== undefined) return;
	writeAtomically(pathOf(dir, word), { ...held, released: now });
}

/**
 * A word nobody holds or reserved, or one a session that no longer runs left behind. With every word
 * held, it adds a number once (`kestrel-2`) and keeps it. The session's own word comes back first, so
 * a resumed session draws nothing.
 */
export function drawWord(
	claiming: Claiming,
	words: readonly string[],
	session: string,
	machine: string,
): Claim | undefined {
	const { dir } = claiming;
	const kept = wordOf(dir, session, claiming.now ?? Date.now());
	if (kept !== undefined) {
		// A resumed session takes its own word back, which clears a release still inside the window.
		claimWord(claiming, kept, session, machine);
		return readClaim(dir, kept);
	}
	const order = shuffled(words, claiming.random ?? Math.random);
	for (const word of order) {
		if (claimWord(claiming, word, session, machine)) return readClaim(dir, word);
	}
	for (const base of order) {
		for (let number = 2; number <= CROWD; number++) {
			const word = `${base}-${number}`;
			if (claimWord(claiming, word, session, machine)) return readClaim(dir, word);
		}
	}
	return undefined;
}

function shuffled(words: readonly string[], random: () => number): string[] {
	const order = [...words];
	for (let index = order.length - 1; index > 0; index--) {
		const other = Math.floor(random() * (index + 1));
		const one = order[index] as string;
		order[index] = order[other] as string;
		order[other] = one;
	}
	return order;
}

function pathOf(dir: string, word: string): string {
	return join(dir, `${word}.json`);
}

/** Creates the file with its claim, or says that someone else got there first. */
function takeFile(path: string, claim: Claim): "taken" | "exists" {
	let fd: number;
	try {
		fd = openSync(path, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
		throw error;
	}
	try {
		writeFileSync(fd, `${JSON.stringify(claim)}\n`);
	} finally {
		closeSync(fd);
	}
	return "taken";
}

function writeAtomically(path: string, claim: Claim): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(claim)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

// One file per word, created with `link`, which fails when the word is taken. A crashed session's
// claim is judged against presence, so its word comes back.
import {
	linkSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { isObject } from "../decode.ts";

/** So a resumed session gets its word back. */
export const RESERVED_MS = 7 * 24 * 60 * 60 * 1000;
const CROWD = 99;
/** A reclaim takes milliseconds. */
const LOCK_MS = 10_000;
let temporaries = 0;

export interface Claim {
	word: string;
	session: string;
	machine: string;
	at: number;
	/** Absent while held. */
	released?: number;
}

export interface Claiming {
	dir: string;
	now?: number;
	/** Defaults to true, which keeps every claim. */
	lives?: (session: string) => boolean;
	random?: () => number;
}

export function readClaim(dir: string, word: string): Claim | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(pathOf(dir, word), "utf8"));
		if (!isObject(value)) return undefined;
		const { word: held, session, machine, at, released } = value;
		if (typeof held !== "string" || typeof session !== "string" || typeof machine !== "string")
			return undefined;
		if (typeof at !== "number" || (released !== undefined && typeof released !== "number"))
			return undefined;
		// A file named for one word that holds another was written by something else.
		if (held !== word) return undefined;
		return { word: held, session, machine, at, ...(released === undefined ? {} : { released }) };
	} catch {
		return undefined;
	}
}

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

/** Includes a word let go within the reservation, so a resumed session keeps its handle. */
export function wordOf(dir: string, session: string, now = Date.now()): string | undefined {
	return claims(dir).find(
		(claim) =>
			claim.session === session &&
			(claim.released === undefined || now - claim.released < RESERVED_MS),
	)?.word;
}

/**
 * Replaces only a claim whose session is gone, whose reservation expired, or whose file is unreadable.
 * Synchronous, so two draws in one process never both create.
 */
export function claimWord(
	claiming: Claiming,
	word: string,
	session: string,
	machine: string,
): boolean {
	if (!/^[a-z][a-z0-9-]*$/.test(word)) throw new Error(`not a word a handle may hold: ${word}`);
	try {
		return attemptClaim(claiming, word, session, machine);
	} catch (error) {
		// A read-only folder or a full disk leaves the draw empty, and the feature falls back to `new-<id4>`.
		if (isObject(error) && typeof error.code === "string") return false;
		throw error;
	}
}

function attemptClaim(claiming: Claiming, word: string, session: string, machine: string): boolean {
	const { dir } = claiming;
	const now = claiming.now ?? Date.now();
	mkdirSync(dir, { recursive: true });
	const path = pathOf(dir, word);
	if (createFile(path, { word, session, machine, at: now }) !== "exists") return true;

	const held = readClaim(dir, word);
	if (held?.session === session) {
		// A resumed session keeps its claim; a word it let go is taken back.
		writeAtomically(path, { ...held, machine, at: now, released: undefined });
		return true;
	}
	const stale = () => {
		const claim = readClaim(dir, word);
		if (claim === undefined) return true;
		if (claim.session === session) return false;
		const expired = claim.released !== undefined && now - claim.released >= RESERVED_MS;
		const crashed =
			claim.machine === machine &&
			claim.released === undefined &&
			!(claiming.lives ?? (() => true))(claim.session);
		return expired || crashed;
	};
	if (!stale()) return false;

	// Judge the stale claim again under the lock, or a second reclaimer removes the first one's claim.
	const lock = lockWord(dir, word, now);
	if (lock === undefined) return false;
	try {
		if (!stale()) return false;
		rmSync(path, { force: true });
		return createFile(path, { word, session, machine, at: now }) !== "exists";
	} finally {
		rmSync(lock, { force: true });
	}
}

function lockWord(dir: string, word: string, now: number): string | undefined {
	const lock = `${pathOf(dir, word)}.lock`;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (createFile(lock, { at: now }) !== "exists") return lock;
		let at: number;
		try {
			const value: unknown = JSON.parse(readFileSync(lock, "utf8"));
			at = isObject(value) && typeof value.at === "number" ? value.at : 0;
		} catch {
			at = 0;
		}
		if (now - at < LOCK_MS) return undefined;
		// Renaming the dead lock away breaks it for exactly one process.
		const grave = `${lock}.${process.pid}.stale`;
		try {
			renameSync(lock, grave);
		} catch {
			return undefined;
		}
		rmSync(grave, { force: true });
	}
	return undefined;
}

export function releaseWord(dir: string, word: string, session: string, now = Date.now()): void {
	const held = readClaim(dir, word);
	if (held === undefined || held.session !== session || held.released !== undefined) return;
	writeAtomically(pathOf(dir, word), { ...held, released: now });
}

/** With every word held, adds a number once (`kestrel-2`). The session's own word comes first. */
export function drawWord(
	claiming: Claiming,
	words: readonly string[],
	session: string,
	machine: string,
): Claim | undefined {
	const { dir } = claiming;
	const kept = wordOf(dir, session, claiming.now ?? Date.now());
	if (kept !== undefined) {
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

/** Written to a temporary file and linked into place, so no reader sees an empty claim. */
function createFile(path: string, value: unknown): "taken" | "exists" {
	const temporary = `${path}.${process.pid}.${temporaries++}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
	try {
		linkSync(temporary, path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
		throw error;
	} finally {
		rmSync(temporary, { force: true });
	}
	return "taken";
}

function writeAtomically(path: string, claim: Claim): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(claim)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

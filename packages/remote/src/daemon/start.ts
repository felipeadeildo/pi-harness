// Starting pi from the page: in a folder of this machine, in a session of the remote's own tmux, so
// `pi-remote attach` opens it at the desk. Off until the operator turns it on at this machine.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join } from "node:path";

import { isObject } from "@adeildo/pi-remote-protocol";

import { shellQuoted } from "../launcher.ts";
import {
	globalSetting,
	piSessionsDir,
	START_ID,
	STARTED_BY_ENV,
	TICKET_ENV,
	TMUX_SOCKET,
} from "../places.ts";
import { Refused } from "./refused.ts";

/**
 * Pi tells Shift+Enter from Enter only through extended keys (pi's docs, tmux.md); set before the
 * session, so pi's request at start is honored. `-q` skips an option an older tmux lacks.
 */
const EXTENDED_KEYS = [
	"set",
	"-gq",
	"extended-keys",
	"on",
	";",
	"set",
	"-gq",
	"extended-keys-format",
	"csi-u",
	";",
];

const RECENT = 30;
const HEAD_BYTES = 4_096;
const WAIT_MS = 20_000;
/** Well under what a tmux command line holds. */
const PROMPT_CHARS = 4_000;

export interface RecentFolder {
	path: string;
	/** When pi last wrote a session there, in ms. */
	at: number;
}

export interface StartRequest {
	folder: string;
	/** Pi's first message, as `pi -- <prompt>` takes it. */
	prompt?: string;
	/** The session that asked, passed on as `PI_STARTED_BY`. */
	by?: string;
}

export interface StartContext {
	machine: string;
	arrival: (ticket: string, ms: number) => Promise<string | undefined>;
	/** Over HTTP: the page, or another machine's daemon. */
	fromClient: boolean;
}

export interface StartOptions {
	/** Whether the operator turned it on; the global setting by default, never a project's. */
	allowed?: () => boolean;
	sessionsDir?: string;
	tmux?: string;
	/** Found on PATH by default. */
	pi?: string;
	waitMs?: number;
}

/** What a client may ask of this machine about new sessions. */
export class Starts {
	readonly #options: StartOptions;

	constructor(options: StartOptions = {}) {
		this.#options = options;
	}

	allowed(): boolean {
		return this.#options.allowed?.() ?? globalSetting(START_ID) === true;
	}

	/** The folders pi worked in, newest first; only the ones still there. */
	async folders(): Promise<RecentFolder[]> {
		return recentFolders(this.#options.sessionsDir ?? piSessionsDir());
	}

	/**
	 * Starts pi in the folder, with `prompt` as its first message, and answers its session once pi's
	 * bridge registers with the ticket. A client's request needs the setting; this machine's own pi
	 * asks the operator first.
	 */
	async start(
		{ folder, prompt, by }: StartRequest,
		{ machine, arrival, fromClient }: StartContext,
	): Promise<string> {
		if (fromClient && !this.allowed())
			throw new Refused(
				403,
				`starting sessions from the page is off on ${machine}: turn on "${START_ID}" in pi's settings there`,
			);
		if (prompt !== undefined && prompt.length > PROMPT_CHARS)
			throw new Refused(400, `a first message has at most ${PROMPT_CHARS} characters`);
		const at = await folderOf(folder);
		const pi = this.#options.pi ?? (await onPath("pi"));
		if (pi === undefined) throw new Refused(503, `pi is not on ${machine}'s PATH`);
		const ticket = randomUUID();
		const waitMs = this.#options.waitMs ?? WAIT_MS;
		// Waiting before tmux runs, so a pi that registers at once is not missed.
		const arrived = arrival(ticket, waitMs);
		const ran = await run(this.#options.tmux ?? "tmux", [
			"-L",
			TMUX_SOCKET,
			...EXTENDED_KEYS,
			"new-session",
			"-d",
			"-s",
			sessionName(at, ticket),
			"-c",
			at,
			"-e",
			`${TICKET_ENV}=${ticket}`,
			...(by === undefined ? [] : ["-e", `${STARTED_BY_ENV}=${by}`]),
			prompt === undefined || prompt === ""
				? `exec ${shellQuoted(pi)}`
				: `exec ${shellQuoted(pi)} -- ${shellQuoted(prompt)}`,
		]);
		if (ran.code === undefined) throw new Refused(503, `tmux is not installed on ${machine}`);
		if (ran.code !== 0) throw new Error(`tmux could not start the session: ${ran.err.trim()}`);
		const session = await arrived;
		if (session === undefined)
			throw new Refused(
				504,
				`pi started on ${machine} but did not reach the remote in ${waitMs / 1000} s: run pi-remote attach there to see it`,
			);
		return session;
	}
}

/** An absolute folder, or one under `~`, that exists. */
async function folderOf(folder: string): Promise<string> {
	const path = folder.replace(/^~(?=\/|$)/, homedir());
	if (!isAbsolute(path))
		throw new Refused(400, "the folder must be an absolute path or start with ~");
	const real = await realpath(path).catch(() => {
		throw new Refused(404, `there is no folder at ${folder}`);
	});
	if (!(await stat(real)).isDirectory())
		throw new Refused(400, `${folder} is a file, not a folder`);
	return real;
}

/** tmux refuses `.` and `:` in a session name. */
function sessionName(folder: string, ticket: string): string {
	return `${basename(folder).replaceAll(/[.:]/g, "-") || "pi"}-${ticket.slice(0, 4)}`;
}

async function onPath(name: string): Promise<string | undefined> {
	for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const path = join(dir, name);
		if (
			await access(path, constants.X_OK).then(
				() => true,
				() => false,
			)
		)
			return path;
	}
	return undefined;
}

/** The first line of each folder's newest session names the folder pi worked in. */
async function recentFolders(dir: string): Promise<RecentFolder[]> {
	const kept = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const found = await Promise.all(
		kept
			.filter((one) => one.isDirectory())
			.map(async (one): Promise<RecentFolder | undefined> => {
				const files = await readdir(join(dir, one.name)).catch(() => []);
				// Pi names a session file after its start time, so the last by name is the newest.
				const newest = files
					.filter((file) => file.endsWith(".jsonl"))
					.toSorted()
					.at(-1);
				if (newest === undefined) return undefined;
				const file = join(dir, one.name, newest);
				const [cwd, written] = await Promise.all([cwdOf(file), stat(file).catch(() => undefined)]);
				if (cwd === undefined || written === undefined) return undefined;
				const there = await stat(cwd).then(
					(info) => info.isDirectory(),
					() => false,
				);
				return there ? { path: cwd, at: written.mtimeMs } : undefined;
			}),
	);
	return found
		.filter((one) => one !== undefined)
		.toSorted((a, b) => b.at - a.at)
		.slice(0, RECENT);
}

async function cwdOf(file: string): Promise<string | undefined> {
	try {
		const handle = await open(file, "r");
		try {
			const buffer = Buffer.alloc(HEAD_BYTES);
			const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
			const head: unknown = JSON.parse(
				buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "",
			);
			return typeof head === "object" &&
				head !== null &&
				"cwd" in head &&
				typeof head.cwd === "string"
				? head.cwd
				: undefined;
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
}

/** `code` is undefined when the program could not start. */
function run(
	command: string,
	args: readonly string[],
): Promise<{ code: number | undefined; err: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
			err += chunk;
		});
		child.once("error", () => resolve({ code: undefined, err }));
		child.once("close", (code) => resolve({ code: code ?? 1, err }));
	});
}

/** A start from JSON text or an object; undefined when it is not one. */
export function startIn(value: unknown): StartRequest | undefined {
	let data = value;
	if (typeof value === "string") {
		try {
			data = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	if (!isObject(data) || typeof data.folder !== "string") return undefined;
	if (data.prompt !== undefined && typeof data.prompt !== "string") return undefined;
	// A session id goes into tmux's environment; nothing else may.
	if (data.by !== undefined && (typeof data.by !== "string" || !/^[\w-]{1,80}$/.test(data.by)))
		return undefined;
	return {
		folder: data.folder,
		...(data.prompt === undefined ? {} : { prompt: data.prompt }),
		...(data.by === undefined ? {} : { by: data.by }),
	};
}

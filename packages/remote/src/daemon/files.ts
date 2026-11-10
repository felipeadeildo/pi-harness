// A session's folder, read only: one folder level, one file, and what git says changed. Nothing
// leaves the folder: a path that climbs out of it, or a link that points out of it, is refused, and so
// is anything inside `.git`.
import { spawn } from "node:child_process";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";

import type {
	ChangedFile,
	Changes,
	ChangeStatus,
	FileDiff,
	FileView,
	Folder,
	FolderEntry,
} from "@adeildo/pi-remote-protocol";

const FOLDER_ENTRIES = 2_000;
export const TEXT_BYTES = 1_000_000;
const SNIFF_BYTES = 8_000;
const CHANGED_FILES = 1_000;
export const PATCH_BYTES = 2_000_000;
const LIST_BYTES = 8_000_000;
const GIT_MS = 10_000;

export class Refused extends Error {
	readonly status: 400 | 404;

	constructor(status: 400 | 404, message: string) {
		super(message);
		this.name = "Refused";
		this.status = status;
	}
}

export async function folderAt(cwd: string, path: string): Promise<Folder> {
	const { real, parts } = await inside(cwd, path);
	const listed = await readdir(real, { withFileTypes: true }).catch((error: unknown) => {
		throw codeOf(error) === "ENOTDIR"
			? new Refused(400, "that is a file, not a folder")
			: new Refused(404, "the folder could not be read");
	});
	const entries = (
		await Promise.all(
			listed
				.filter((one) => one.name !== ".git")
				.map(async (one): Promise<FolderEntry | undefined> => {
					// A link counts as what it points at; one that points nowhere is left out.
					const found = await stat(join(real, one.name)).catch(() => undefined);
					if (found === undefined) return undefined;
					return found.isDirectory()
						? { name: one.name, kind: "dir" }
						: { name: one.name, kind: "file", size: found.size };
				}),
		)
	)
		.filter((one) => one !== undefined)
		.toSorted(byKindThenName);
	const shown = entries.slice(0, FOLDER_ENTRIES);
	const ignored = await ignoredOf(
		real,
		shown.map((one) => one.name),
	);
	return {
		path: parts.join("/"),
		entries: shown.map((one) => (ignored.has(one.name) ? { ...one, ignored: true } : one)),
		...(entries.length > shown.length ? { more: true } : {}),
	};
}

export async function fileAt(cwd: string, path: string): Promise<FileView> {
	const { real, parts } = await inside(cwd, path);
	const found = await stat(real);
	if (found.isDirectory()) throw new Refused(400, "that is a folder, not a file");
	if (!found.isFile()) throw new Refused(400, "that is not a regular file");
	const read = await startOf(real, Math.min(found.size, TEXT_BYTES));
	const at = parts.join("/");
	if (isBinary(read)) return { path: at, size: found.size, kind: "binary" };
	return {
		path: at,
		size: found.size,
		kind: "text",
		text: new TextDecoder().decode(read),
		...(found.size > read.length ? { truncated: true } : {}),
	};
}

export async function changesAt(cwd: string): Promise<Changes> {
	const root = await rootOf(cwd);
	const prefix = await git(root, ["rev-parse", "--show-prefix"]);
	if (prefix.code !== 0) return { repo: false };
	const local = localPath(prefix.out.toString("utf8").replace(/\n$/, ""));
	const base = await baseOf(root);
	const [status, numstat] = await Promise.all([
		git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."], {
			limit: LIST_BYTES,
		}),
		git(
			root,
			["diff", base, "--numstat", "-z", "-M", "--no-ext-diff", "--no-textconv", "--", "."],
			{
				limit: LIST_BYTES,
			},
		),
	]);
	const counts = countsOf(numstat.out.toString("utf8"), local);
	const all = statusOf(status.out.toString("utf8"), local);
	// The last path of a status cut at the limit is cut too.
	if (status.cut) all.pop();
	const files = await Promise.all(
		all.slice(0, CHANGED_FILES).map(async (one): Promise<ChangedFile> => {
			const lines =
				one.status === "untracked" ? await linesOf(join(root, one.path)) : counts.get(one.path);
			return lines === undefined ? one : { ...one, added: lines.added, removed: lines.removed };
		}),
	);
	const more = all.length > files.length || status.cut;
	return { repo: true, files, ...(more ? { more: true } : {}) };
}

export async function diffAt(cwd: string, path: string): Promise<FileDiff> {
	const parts = partsOf(path);
	if (parts.length === 0)
		throw new Refused(400, "a diff is of one file inside the session's folder");
	const root = await rootOf(cwd);
	const at = parts.join("/");
	// From the repository's root, where `git status` writes a rename's old path.
	const where = await git(root, ["rev-parse", "--show-toplevel", "--show-prefix"]);
	if (where.code !== 0) throw new Refused(404, "the session's folder is not in a git repository");
	const [top = root, prefix = ""] = where.out.toString("utf8").split("\n");
	const full = `${prefix}${at}`;
	// The whole folder, since a status of the new path alone sees a rename as an added file.
	const status = await git(
		top,
		["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", prefix || "."],
		{ limit: LIST_BYTES },
	);
	const change = statusOf(status.out.toString("utf8"), (same) => same).find(
		(one) => one.path === full,
	);
	const patch =
		change?.status === "untracked"
			? await git(top, ["diff", "--no-index", ...PATCH_FLAGS, "--", "/dev/null", full], {
					limit: PATCH_BYTES,
				})
			: await git(
					top,
					[
						"diff",
						await baseOf(top),
						"-M",
						...PATCH_FLAGS,
						"--",
						...(change?.from === undefined ? [] : [change.from]),
						full,
					],
					{ limit: PATCH_BYTES },
				);
	return {
		path: at,
		patch: patch.out.toString("utf8"),
		...(patch.cut ? { truncated: true } : {}),
	};
}

/** The user's git config may change the prefixes or run an external tool; the page reads plain patches. */
const PATCH_FLAGS = [
	"--no-color",
	"--no-ext-diff",
	"--no-textconv",
	"--src-prefix=a/",
	"--dst-prefix=b/",
];

async function inside(cwd: string, path: string): Promise<{ real: string; parts: string[] }> {
	const parts = partsOf(path);
	const root = await rootOf(cwd);
	const real = await realpath(join(root, ...parts)).catch(() => {
		throw new Refused(404, "no such path in the session's folder");
	});
	if (real !== root && !real.startsWith(root + sep))
		throw new Refused(404, "that path leads out of the session's folder");
	return { real, parts };
}

async function rootOf(cwd: string): Promise<string> {
	return realpath(cwd).catch(() => {
		throw new Refused(404, "the session's folder is gone");
	});
}

/** A relative path with no `..` and no `.git`; `""` is the folder itself. */
function partsOf(path: string): string[] {
	if (path.includes("\0") || isAbsolute(path) || /^[a-zA-Z]:/.test(path))
		throw new Refused(400, "that path is not inside the session's folder");
	const parts = path.split(/[/\\]/).filter((part) => part !== "" && part !== ".");
	if (parts.includes("..")) throw new Refused(400, "that path is not inside the session's folder");
	if (parts.includes(".git")) throw new Refused(404, "git's own files stay closed");
	return parts;
}

function byKindThenName(a: FolderEntry, b: FolderEntry): number {
	if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
	return a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.name < b.name ? -1 : 1);
}

async function ignoredOf(folder: string, names: readonly string[]): Promise<Set<string>> {
	if (names.length === 0) return new Set();
	// `check-ignore` refuses `--literal-pathspecs`, and a name only decides how an entry is drawn.
	const ran = await git(folder, ["check-ignore", "-z", "--stdin"], {
		input: `${names.join("\0")}\0`,
		limit: LIST_BYTES,
		literal: false,
	});
	// 1 means none is ignored, and 128 a folder outside a repository.
	if (ran.code !== 0) return new Set();
	return new Set(ran.out.toString("utf8").split("\0").filter(Boolean));
}

/** The last commit, or the empty tree in a repository that has none yet. */
async function baseOf(root: string): Promise<string> {
	const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
	if (head.code === 0) return "HEAD";
	const empty = await git(root, ["hash-object", "-t", "tree", "--stdin"], { input: "" });
	return empty.out.toString("utf8").trim();
}

/** Git writes paths from the repository's root; the page reads them from the session's folder. */
function localPath(prefix: string): (path: string) => string {
	return (path) => (path.startsWith(prefix) ? path.slice(prefix.length) : path);
}

/** `git status --porcelain=v1 -z`: `XY path`, and `XY to` then `from` for a rename or a copy. */
export function statusOf(text: string, local: (path: string) => string): ChangedFile[] {
	const fields = text.split("\0");
	const files: ChangedFile[] = [];
	for (let at = 0; at < fields.length; at++) {
		const field = fields[at] ?? "";
		if (field.length < 4) continue;
		const code = field.slice(0, 2);
		const path = local(field.slice(3));
		const status = changeOf(code);
		if (code.includes("R") || code.includes("C")) {
			const from = fields[++at] ?? "";
			files.push(
				code.includes("R") ? { path, from: local(from), status } : { path, status: "added" },
			);
		} else files.push({ path, status });
	}
	return files;
}

function changeOf(code: string): ChangeStatus {
	if (code === "??") return "untracked";
	if (code.includes("U") || code === "AA" || code === "DD") return "conflicted";
	if (code.includes("R")) return "renamed";
	if (code[0] === "A") return "added";
	if (code.includes("D")) return "deleted";
	return "modified";
}

/** `git diff --numstat -z`: `added\tremoved\tpath`, or `added\tremoved\t` then `from` and `to`. */
export function countsOf(
	text: string,
	local: (path: string) => string,
): Map<string, { added: number; removed: number }> {
	const counts = new Map<string, { added: number; removed: number }>();
	const fields = text.split("\0");
	for (let at = 0; at < fields.length; at++) {
		const [added = "", removed = "", path = ""] = (fields[at] ?? "").split("\t");
		const to = path === "" ? fields[(at += 2)] : path;
		// A binary file counts as `-`.
		if (to === undefined || to === "" || added === "-" || added === "") continue;
		counts.set(local(to), { added: Number(added), removed: Number(removed) });
	}
	return counts;
}

async function linesOf(path: string): Promise<{ added: number; removed: number } | undefined> {
	const found = await stat(path).catch(() => undefined);
	if (found === undefined || !found.isFile() || found.size > TEXT_BYTES) return undefined;
	const bytes = await startOf(path, found.size).catch(() => undefined);
	if (bytes === undefined || isBinary(bytes)) return undefined;
	let lines = 0;
	for (const byte of bytes) if (byte === 10) lines++;
	if (bytes.length > 0 && bytes.at(-1) !== 10) lines++;
	return { added: lines, removed: 0 };
}

async function startOf(path: string, bytes: number): Promise<Buffer> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(bytes);
		const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

/** Git's own test: a NUL in the first bytes. */
function isBinary(bytes: Buffer): boolean {
	return bytes.subarray(0, SNIFF_BYTES).includes(0);
}

interface Ran {
	/** `undefined` when git could not start or ran out of time. */
	code: number | undefined;
	out: Buffer;
	cut: boolean;
}

function git(
	cwd: string,
	args: readonly string[],
	{
		input,
		limit = 64_000,
		literal = true,
	}: { input?: string; limit?: number; literal?: boolean } = {},
): Promise<Ran> {
	return new Promise((resolve) => {
		const child = spawn(
			"git",
			[
				"--no-optional-locks",
				...(literal ? ["--literal-pathspecs"] : []),
				"-c",
				"core.quotepath=off",
				...args,
			],
			{
				cwd,
				env: gitEnv(),
				stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
				timeout: GIT_MS,
			},
		);
		const chunks: Buffer[] = [];
		let size = 0;
		let cut = false;
		child.stdout?.on("data", (chunk: Buffer) => {
			if (cut) return;
			if (size + chunk.length > limit) {
				chunks.push(chunk.subarray(0, limit - size));
				cut = true;
				child.kill();
				return;
			}
			chunks.push(chunk);
			size += chunk.length;
		});
		child.once("error", () => resolve({ code: undefined, out: Buffer.alloc(0), cut: false }));
		child.once("close", (code) =>
			resolve({ code: code ?? undefined, out: Buffer.concat(chunks), cut }),
		);
		// Git outside a repository exits before it reads, and the write would throw in the daemon.
		child.stdin?.on("error", () => {});
		if (input !== undefined) child.stdin?.end(input);
	});
}

/** Git reads `GIT_DIR` and its kin before the folder it runs in, and a git hook sets them. */
function gitEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
	for (const [key, value] of Object.entries(process.env))
		if (!key.startsWith("GIT_")) env[key] = value;
	return env;
}

function codeOf(error: unknown): string | undefined {
	return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

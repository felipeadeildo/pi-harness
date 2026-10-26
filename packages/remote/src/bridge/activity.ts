// What the agent does right now, the git branch it works on and the first line of its last answer:
// the list and the session's top bar read these without the transcript.
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

import type { SessionActivity } from "@adeildo/pi-remote-protocol";

const ABOUT_CHARS = 120;
const SAID_CHARS = 160;

/** In the order a tool's subject is looked for in its arguments. */
const SUBJECTS = ["command", "path", "file_path", "pattern", "query", "url", "action"] as const;

type Doing = Omit<SessionActivity, "since">;

export class Activity {
	#now: SessionActivity | undefined;
	readonly #tools = new Map<string, Doing>();
	readonly #cwd: string;
	readonly #send: (activity: SessionActivity) => void;
	readonly #clock: () => number;

	constructor(cwd: string, send: (activity: SessionActivity) => void, clock = Date.now) {
		this.#cwd = cwd;
		this.#send = send;
		this.#clock = clock;
	}

	get current(): SessionActivity | undefined {
		return this.#now;
	}

	started(): void {
		this.#tools.clear();
		this.#set({ what: "thinking" });
	}

	/** Pi's streamed event types: `thinking_delta`, `text_delta` and the like. */
	streamed(type: string): void {
		if (this.#tools.size > 0) return;
		if (type.startsWith("thinking")) this.#set({ what: "thinking" });
		// A call is written like an answer, until it starts to run.
		else if (type.startsWith("text") || type.startsWith("toolcall")) this.#set({ what: "writing" });
	}

	toolStarted(id: string, tool: string, args: unknown): void {
		const about = aboutOf(args, this.#cwd);
		const doing: Doing = { what: "tool", tool, ...(about === undefined ? {} : { about }) };
		this.#tools.set(id, doing);
		this.#set(doing);
	}

	/** Another call still running keeps the line; the last one hands it back to the model. */
	toolEnded(id: string): void {
		this.#tools.delete(id);
		this.#set([...this.#tools.values()].at(-1) ?? { what: "thinking" });
	}

	compacting(): void {
		this.#set({ what: "compacting" });
	}

	settled(): void {
		this.#tools.clear();
		this.#set({ what: "resting" });
	}

	#set(next: Doing): void {
		const now = this.#now;
		if (now?.what === next.what && now.tool === next.tool && now.about === next.about) return;
		this.#now = { ...next, since: this.#clock() };
		this.#send(this.#now);
	}
}

export function aboutOf(args: unknown, cwd: string): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const fields = args as Record<string, unknown>;
	for (const key of SUBJECTS) {
		const value = fields[key];
		if (typeof value !== "string" || value.trim() === "") continue;
		const line = value.trim().split("\n")[0] ?? "";
		const shown = key === "path" || key === "file_path" ? inside(line, cwd) : line;
		return cut(shown, ABOUT_CHARS);
	}
	return undefined;
}

/** The first line a reader would quote, without the markdown around it. */
export function saidOf(text: string): string | undefined {
	let fenced = false;
	for (const raw of text.split("\n")) {
		if (raw.trim().startsWith("```")) {
			fenced = !fenced;
			continue;
		}
		const line = raw.replace(/^\s*(#{1,6}\s+|[-*]\s+|>\s*)/, "").trim();
		if (!fenced && line !== "") return cut(line.replace(/[*_`]/g, ""), SAID_CHARS);
	}
	return undefined;
}

/** The text parts of a message, joined. */
export function answerOf(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: unknown) =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
				? String((part as { text?: unknown }).text ?? "")
				: "",
		)
		.join("\n");
}

/** `undefined` outside a repository; a detached head reads as its short hash. */
export function branchOf(cwd: string): string | undefined {
	try {
		const git = gitDirOf(cwd);
		if (git === undefined) return undefined;
		const head = readFileSync(join(git, "HEAD"), "utf8").trim();
		const ref = /^ref: refs\/heads\/(.+)$/.exec(head);
		return ref?.[1] ?? head.slice(0, 7);
	} catch {
		return undefined;
	}
}

/**
 * Calls `moved` when the folder's HEAD is written, as a checkout or a switch in another terminal does.
 * Git replaces the file, so the watch is on its folder.
 */
export function watchBranch(cwd: string, moved: () => void): () => void {
	const git = gitDirOf(cwd);
	if (git === undefined) return () => {};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const watcher = watch(git, (_kind, name) => {
			if (name !== "HEAD" || timer !== undefined) return;
			timer = setTimeout(() => {
				timer = undefined;
				moved();
			}, 100);
			timer.unref();
		});
		watcher.on("error", () => {});
		watcher.unref();
		return () => {
			watcher.close();
			if (timer !== undefined) clearTimeout(timer);
		};
	} catch {
		return () => {};
	}
}

function gitDirOf(cwd: string): string | undefined {
	for (let dir = cwd; ; dir = dirname(dir)) {
		const dotGit = join(dir, ".git");
		if (existsSync(dotGit)) {
			if (statSync(dotGit).isDirectory()) return dotGit;
			// A worktree's `.git` is a file that points at its folder.
			const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
			if (pointer === undefined) return undefined;
			return isAbsolute(pointer) ? pointer : join(dir, pointer);
		}
		if (dirname(dir) === dir) return undefined;
	}
}

function inside(path: string, cwd: string): string {
	if (!isAbsolute(path)) return path;
	const near = relative(cwd, path);
	return near.startsWith("..") || near === "" ? path : near;
}

function cut(text: string, chars: number): string {
	return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}

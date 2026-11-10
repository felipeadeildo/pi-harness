// A session's folder as a client reads it: one folder level, one file, and what changed since the
// last commit. Every path is relative to the session's folder, with `/` between parts, and `""` is the
// folder itself.
import { isObject } from "./by.ts";

export interface FolderEntry {
	name: string;
	kind: "dir" | "file";
	/** Bytes, for a file. */
	size?: number;
	/** Git ignores it, so the page can dim it. */
	ignored?: true;
}

export interface Folder {
	path: string;
	entries: FolderEntry[];
	/** More entries than a page shows; the first ones by name are there. */
	more?: true;
}

export type FileView =
	| { path: string; size: number; kind: "text"; text: string; truncated?: true }
	| { path: string; size: number; kind: "binary" };

export const CHANGE_STATUSES = [
	"modified",
	"added",
	"deleted",
	"renamed",
	"untracked",
	"conflicted",
] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export interface ChangedFile {
	path: string;
	/** The path before a rename. */
	from?: string;
	status: ChangeStatus;
	/** Lines; absent for a binary file. */
	added?: number;
	removed?: number;
}

/** Against the last commit, staged or not, and only inside the session's folder. */
export type Changes = { repo: false } | { repo: true; files: ChangedFile[]; more?: true };

export interface FileDiff {
	path: string;
	/** A unified patch; empty when the file has no change. */
	patch: string;
	truncated?: true;
}

export function isFolder(value: unknown): value is Folder {
	return (
		isObject(value) &&
		typeof value.path === "string" &&
		Array.isArray(value.entries) &&
		value.entries.every(
			(one) =>
				isObject(one) &&
				typeof one.name === "string" &&
				(one.kind === "dir" || one.kind === "file") &&
				(one.size === undefined || typeof one.size === "number"),
		)
	);
}

export function isFileView(value: unknown): value is FileView {
	if (!isObject(value) || typeof value.path !== "string" || typeof value.size !== "number")
		return false;
	if (value.kind === "binary") return true;
	return value.kind === "text" && typeof value.text === "string";
}

export function isChanges(value: unknown): value is Changes {
	if (!isObject(value)) return false;
	if (value.repo === false) return true;
	return (
		value.repo === true &&
		Array.isArray(value.files) &&
		value.files.every(
			(one) =>
				isObject(one) &&
				typeof one.path === "string" &&
				(one.from === undefined || typeof one.from === "string") &&
				CHANGE_STATUSES.includes(one.status as ChangeStatus) &&
				(one.added === undefined || typeof one.added === "number") &&
				(one.removed === undefined || typeof one.removed === "number"),
		)
	);
}

export function isFileDiff(value: unknown): value is FileDiff {
	return isObject(value) && typeof value.path === "string" && typeof value.patch === "string";
}

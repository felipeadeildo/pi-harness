// A session's folder through the daemon the client talks to, which asks the session's machine.
import {
	type Changes,
	type FileDiff,
	type FileView,
	type Folder,
	isChanges,
	isFileDiff,
	isFileView,
	isFolder,
} from "../index.ts";
import { ask } from "./ask.ts";

export interface FolderOf {
	machine: string;
	session: string;
}

export function readFolder(
	base: string,
	of: FolderOf,
	path: string,
	speaks: typeof fetch = fetch,
): Promise<Folder> {
	return read(base, of, "files", path, isFolder, "the folder", speaks);
}

export function readFile(
	base: string,
	of: FolderOf,
	path: string,
	speaks: typeof fetch = fetch,
): Promise<FileView> {
	return read(base, of, "file", path, isFileView, "the file", speaks);
}

export function readChanges(
	base: string,
	of: FolderOf,
	speaks: typeof fetch = fetch,
): Promise<Changes> {
	return read(base, of, "changes", undefined, isChanges, "the changes", speaks);
}

export function readDiff(
	base: string,
	of: FolderOf,
	path: string,
	speaks: typeof fetch = fetch,
): Promise<FileDiff> {
	return read(base, of, "diff", path, isFileDiff, "the diff", speaks);
}

function read<T>(
	base: string,
	of: FolderOf,
	route: string,
	path: string | undefined,
	is: (value: unknown) => value is T,
	what: string,
	speaks: typeof fetch,
): Promise<T> {
	const query = path === undefined ? "" : `?${new URLSearchParams({ path })}`;
	return ask(
		base,
		`/sessions/${encodeURIComponent(of.machine)}/${encodeURIComponent(of.session)}/${route}${query}`,
		{ what, decode: (body) => (is(body) ? body : undefined) },
		speaks,
	);
}

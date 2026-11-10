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
import { DaemonAnswer } from "./sessions.ts";

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

async function read<T>(
	base: string,
	of: FolderOf,
	route: string,
	path: string | undefined,
	decodes: (value: unknown) => value is T,
	what: string,
	speaks: typeof fetch,
): Promise<T> {
	const url = new URL(
		`/sessions/${encodeURIComponent(of.machine)}/${encodeURIComponent(of.session)}/${route}`,
		base,
	);
	if (path !== undefined) url.searchParams.set("path", path);
	const answer = await speaks(url, { headers: { accept: "application/json" } });
	if (!answer.ok) throw new DaemonAnswer(answer.status, what, await errorOf(answer));
	const body: unknown = await answer.json();
	if (!decodes(body)) throw new DaemonAnswer(200, `${what} in a shape this client cannot read`);
	return body;
}

async function errorOf(answer: Response): Promise<string | undefined> {
	try {
		const body: unknown = await answer.json();
		return typeof body === "object" && body !== null && "error" in body
			? String(body.error)
			: undefined;
	} catch {
		return undefined;
	}
}

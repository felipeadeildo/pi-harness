// What the folder screen says, decided apart from how it is drawn.
import type { ChangedFile, ChangeStatus } from "@adeildo/pi-remote-protocol";
import { DaemonAnswer, type FolderOf } from "@adeildo/pi-remote-protocol/client";

type FilesTab = "changes" | "tree";

/** Where the folder screen stands, all of it in the address so the back button walks it. */
export interface FilesPlace {
	tab: FilesTab;
	/** The folder shown in the tree. */
	path: string;
	/** The file open in the tree. */
	file?: string;
}

export function placeOf(search: URLSearchParams): FilesPlace {
	const file = search.get("file") ?? undefined;
	const tab: FilesTab = search.get("tab") === "tree" || file !== undefined ? "tree" : "changes";
	return {
		tab,
		path: file === undefined ? (search.get("path") ?? "") : parentOf(file),
		...(file === undefined ? {} : { file }),
	};
}

export function searchOf(place: FilesPlace): string {
	const search = new URLSearchParams();
	if (place.tab === "tree") search.set("tab", "tree");
	if (place.file !== undefined) search.set("file", place.file);
	else if (place.path !== "") search.set("path", place.path);
	const text = search.toString();
	return text === "" ? "" : `?${text}`;
}

export function sessionHref(of: FolderOf): string {
	return `/session/${encodeURIComponent(of.machine)}/${encodeURIComponent(of.session)}`;
}

export function filesHref(of: FolderOf, place?: FilesPlace): string {
	const at = `${sessionHref(of)}/files`;
	return place === undefined ? at : `${at}${searchOf(place)}`;
}

export function parentOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
}

export function nameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

export function childOf(folder: string, name: string): string {
	return folder === "" ? name : `${folder}/${name}`;
}

/** The folder's own name first, then one step per part, each leading to its folder. */
export function crumbsOf(root: string, path: string): { name: string; path: string }[] {
	const crumbs = [{ name: root, path: "" }];
	let at = "";
	for (const part of path.split("/").filter(Boolean)) {
		at = childOf(at, part);
		crumbs.push({ name: part, path: at });
	}
	return crumbs;
}

/** A letter like `git status` prints, and the tone it is drawn in. */
export const STATUS_MARKS: Record<
	ChangeStatus,
	{ letter: string; label: string; tone: "added" | "removed" | "changed" | "conflict" }
> = {
	modified: { letter: "M", label: "Modified", tone: "changed" },
	added: { letter: "A", label: "Added", tone: "added" },
	untracked: { letter: "U", label: "Untracked", tone: "added" },
	deleted: { letter: "D", label: "Deleted", tone: "removed" },
	renamed: { letter: "R", label: "Renamed", tone: "changed" },
	conflicted: { letter: "!", label: "Conflicted", tone: "conflict" },
};

/** `more` when the daemon listed only the first files. */
export function changesLine(files: number, more: boolean): string {
	if (files === 0) return "No changes since the last commit.";
	if (more) return `${files}+ files changed since the last commit`;
	return `${files} ${files === 1 ? "file" : "files"} changed since the last commit`;
}

/** Lines added and removed over every file that has a count. */
export function totalsOf(files: readonly ChangedFile[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const one of files) {
		added += one.added ?? 0;
		removed += one.removed ?? 0;
	}
	return { added, removed };
}

export function sizeText(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Past this, a file is drawn plain: highlighting it would hold a phone for seconds. */
export const HIGHLIGHT_BYTES = 200_000;

/** The daemon's own words when it refused, and a plain sentence when it could not be reached. */
export function whyOf(error: unknown, what: string): string {
	if (error instanceof DaemonAnswer) {
		if (error.reason !== undefined) return capitalized(error.reason);
		if (error.status === 401) return "Not logged in. Ask pi for a new link with /remote.";
		if (error.status === 502) return "The session's machine did not answer.";
		return `The daemon answered ${error.status} for ${what}.`;
	}
	return `The daemon could not be reached for ${what}.`;
}

function capitalized(text: string): string {
	const sentence = text.charAt(0).toUpperCase() + text.slice(1);
	return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";

import type { OutsideScope } from "#core/config/schema.ts";

export const OUTSIDE_SCOPES: readonly OutsideScope[] = ["ask", "allow", "deny"];

export const OUTSIDE_DESCRIPTION: Record<OutsideScope, string> = {
	ask: "a call outside the workspace asks you, in every mode",
	allow: "a call outside the workspace follows the mode",
	deny: "a call outside the workspace is blocked",
};

const PASTED_IMAGE_PREFIXES = ["pi-clipboard-", "pi-ask-permission-"];

// So `2>/dev/null` stays in the workspace.
const DEVICES = new Set([
	"/dev/null",
	"/dev/zero",
	"/dev/random",
	"/dev/urandom",
	"/dev/tty",
	"/dev/stdin",
	"/dev/stdout",
	"/dev/stderr",
]);

/** `unknown`: the paths hide behind `$VAR` or `$(...)`. */
export type Reach = { kind: "inside" } | { kind: "outside"; path: string } | { kind: "unknown" };

/** Alt+W. It never lands on `deny`, which takes the command. */
export function toggleOutside(outside: OutsideScope): OutsideScope {
	return outside === "allow" ? "ask" : "allow";
}

// realpath, so a symlink out of the project does not count as inside.
export function reachOf(roots: string[], cwd: string, paths: string[] | undefined): Reach {
	if (paths === undefined) return { kind: "unknown" };

	const resolved = resolveRoots(roots, cwd);
	const temp = canonical(tmpdir());
	for (const path of paths) {
		const lexical = normalize(resolvePath(path, cwd));
		// realpath turns /dev/stdout into the terminal's device.
		if (isDevice(lexical)) continue;

		const absolute = canonical(lexical);
		if (isPastedFile(absolute, temp)) continue;
		if (!isInside(absolute, resolved)) return { kind: "outside", path };
	}
	return { kind: "inside" };
}

export function resolveRoots(roots: string[], cwd: string): string[] {
	const list = roots.length > 0 ? roots : ["."];
	return list.map((root) => canonical(resolvePath(root, cwd)));
}

function resolvePath(path: string, cwd: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return resolve(cwd, path);
}

function canonical(path: string): string {
	const lexical = normalize(path);
	try {
		return realpathSync(lexical);
	} catch {
		try {
			return join(realpathSync(dirname(lexical)), basename(lexical));
		} catch {
			return lexical;
		}
	}
}

function isInside(path: string, roots: string[]): boolean {
	return roots.some((root) => {
		const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
		return path === root || path.startsWith(prefix);
	});
}

function isDevice(path: string): boolean {
	return DEVICES.has(path) || /^\/dev\/fd\/\d+$/.test(path) || /^\/proc\/self\/fd\/\d+$/.test(path);
}

function isPastedFile(path: string, temp: string): boolean {
	if (dirname(path) !== temp) return false;
	return PASTED_IMAGE_PREFIXES.some((prefix) => basename(path).startsWith(prefix));
}

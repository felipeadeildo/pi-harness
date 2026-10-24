// The web app the daemon serves: the files the build exported, and nothing else. The build writes
// `files.json` next to them, and a request is answered only from that list, so a path a client makes
// up never reaches the filesystem, and the login check (C6) asks the same list what is public.
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { POLICY, policyFor } from "./web.ts";

/** The list the build writes next to the export: every file, as a path from `/`. */
export const FILES = "files.json";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".ttf": "font/ttf",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export interface WebApp {
	/** The folder of the export. */
	dir: string;
	/** Every file of the export, as a path from `/`. */
	files: ReadonlySet<string>;
	/** The pages of routes with a parameter, such as `/session/[machine]/[id].html`, to match against. */
	dynamic: readonly { page: string; pattern: RegExp }[];
}

export interface Served {
	status: 200 | 404;
	type: string;
	headers: Record<string, string>;
	body: Buffer | string;
}

/**
 * The app in `dir`, or undefined when the folder holds no export the build listed, or a list that
 * does not read. A broken list costs the app and never the daemon: the data routes still answer.
 */
export function loadWebApp(dir: string): WebApp | undefined {
	const list = join(dir, FILES);
	if (!existsSync(list)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(list, "utf8"));
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed) || !parsed.every((one) => typeof one === "string")) return undefined;
	const files = new Set(parsed as string[]);
	const dynamic = [...files]
		.filter((file) => file.endsWith(".html") && file.includes("["))
		.map((page) => ({ page, pattern: patternOf(page) }))
		// A route with fewer parameters is more specific, as Expo Router ranks them.
		.toSorted((a, b) => count(a.page, "[") - count(b.page, "["));
	return { dir, files, dynamic };
}

/**
 * The export's file for a request path: the file itself, its page (`/x` is `/x.html` or
 * `/x/index.html`), or the page of a route with parameters. Undefined when the export has none of
 * them, so data routes answered before this one are never shadowed by a file of the same name.
 */
export function fileFor(app: WebApp, path: string): string | undefined {
	const clean = path.endsWith("/") ? `${path}index.html` : path;
	for (const candidate of [clean, `${clean}.html`, `${clean}/index.html`])
		if (app.files.has(candidate)) return candidate;
	return app.dynamic.find(({ pattern }) => pattern.test(path))?.page;
}

/** Whether a path is one of the app's own files, which a browser fetches before it has a login. */
export function isAppFile(app: WebApp, path: string): boolean {
	return fileFor(app, path) !== undefined;
}

/**
 * The response for a path: the file with its type, and every page with the policy that allows its
 * own inline scripts and nothing else. A path the export does not have gets its not-found page.
 */
export function serveApp(app: WebApp, path: string): Served {
	const file = fileFor(app, path);
	const missing = file === undefined;
	const chosen = file ?? (app.files.has("/+not-found.html") ? "/+not-found.html" : undefined);
	if (chosen === undefined) {
		return { status: 404, type: TYPES[".html"]!, headers: {}, body: "not found" };
	}
	const type = TYPES[extname(chosen)] ?? "application/octet-stream";
	const body = readFileSync(join(app.dir, chosen));
	const html = extname(chosen) === ".html";
	return {
		status: missing ? 404 : 200,
		type,
		headers: {
			// The page's hashes come from the same bytes that are sent, so the two cannot disagree.
			"content-security-policy": html ? policyFor(body.toString("utf8")) : POLICY,
			// Expo names its bundles by their hash, so they never change under the same name.
			"cache-control": chosen.startsWith("/_expo/static/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
			"x-content-type-options": "nosniff",
		},
		body,
	};
}

function patternOf(page: string): RegExp {
	const route = page.replace(/\.html$/, "").replace(/\/index$/, "");
	const source = route
		.split("/")
		.map((segment) => {
			if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return ".+";
			if (/^\[[^\]]+\]$/.test(segment)) return "[^/]+";
			return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		})
		.join("/");
	return new RegExp(`^${source}/?$`);
}

function count(text: string, of: string): number {
	return text.split(of).length - 1;
}

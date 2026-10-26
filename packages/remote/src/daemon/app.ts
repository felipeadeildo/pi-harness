// The app the daemon serves: the files the build exported and nothing else. A request is answered
// only from the list the build wrote, so a path a client makes up never reaches the filesystem.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

import { POLICY, policyFor } from "./web.ts";

/** The list the build writes next to the export: every file, as a path from `/`. */
const FILES = "files.json";

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

/** The paths the page draws with its router, each answered by `/index.html`. */
const ROUTES = [/^\/session\/[^/]+\/[^/]+\/?$/];

export interface WebApp {
	/** The export's folder. */
	dir: string;
	/** As a path from `/`. */
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
 * Where the export is, for code that lives in `from`: `dist/web` next to a built file, the package's
 * last build for code run from `src/<folder>/`, or `PI_REMOTE_WEB`. Undefined when none holds a list.
 */
export function findWebDir(from: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const candidates = [env.PI_REMOTE_WEB, join(from, "web"), join(from, "..", "..", "dist", "web")];
	return candidates.find((dir) => dir !== undefined && existsSync(join(dir, FILES)));
}

/**
 * The app in `dir`, or undefined when no export the build listed is there. A broken list costs the
 * app and never the daemon: the data routes still answer.
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
	const page = app.dynamic.find(({ pattern }) => pattern.test(path))?.page;
	if (page !== undefined) return page;
	// A route the page draws itself has no file: the browser asks for the address and the page's one
	// `index.html` answers, then the router reads the address. Only the page's routes, so a made-up
	// path (`/login`, `/sessions`, `/x.js`) still reaches the daemon's own routes or a 404.
	return ROUTES.some((route) => route.test(path)) && app.files.has("/index.html")
		? "/index.html"
		: undefined;
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
			// The bundles are named by their hash, so they never change under the same name.
			"cache-control":
				chosen.startsWith("/_expo/static/") || chosen.startsWith("/assets/")
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

/**
 * Puts the app's web export in `outdir/web`, with `files.json` listing every file as a path from
 * `/`. The daemon answers only from that list, and the login check reads the same list to know what
 * a browser may fetch before it logs in.
 */
export function packageWeb(exported: string, outdir: string): string[] {
	const web = join(outdir, "web");
	rmSync(web, { recursive: true, force: true });
	cpSync(exported, web, { recursive: true });
	const files = listed(web);
	writeFileSync(join(web, FILES), `${JSON.stringify(files, null, "\t")}\n`);
	return files;
}

/** Every file under `dir`, as a path from `/`, in a stable order. */
function listed(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => `/${relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/")}`)
		.toSorted();
}

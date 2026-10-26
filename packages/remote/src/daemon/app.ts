// The page's build, listed when its page changes, so a made-up path never reaches the filesystem.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

const ROUTES = [/^\/session\/[^/]+\/[^/]+\/?$/];

/** The build inlines no script, so none is hashed. */
export const POLICY = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"font-src 'self' data:",
	"connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
	"object-src 'none'",
].join("; ");

export interface WebApp {
	dir: string;
	files: ReadonlySet<string>;
	/** The listed build's `index.html`; another one is a new build, with new hashed names. */
	page: number;
}

export interface Served {
	status: 200 | 404;
	type: string;
	headers: Record<string, string>;
	body: Buffer | string;
}

/** `web` next to a built file, the last build when run from `src/`, or `PI_REMOTE_WEB`. */
export function findWebDir(from: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const candidates = [env.PI_REMOTE_WEB, join(from, "web"), join(from, "..", "..", "dist", "web")];
	return candidates.find((dir) => dir !== undefined && existsSync(join(dir, "index.html")));
}

export function loadWebApp(dir: string): WebApp | undefined {
	const page = pageOf(dir);
	if (page === undefined) return undefined;
	return { dir, files: listed(dir), page };
}

function pageOf(dir: string): number | undefined {
	return statSync(join(dir, "index.html"), { throwIfNoEntry: false })?.mtimeMs;
}

function listed(dir: string): Set<string> {
	const files = readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => `/${relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/")}`);
	return new Set(files);
}

/** `index.html` for `/` and the page's routes; undefined otherwise, so other paths reach the routes. */
export function fileFor(app: WebApp, path: string): string | undefined {
	if (path === "/" || ROUTES.some((route) => route.test(path))) return "/index.html";
	const page = pageOf(app.dir);
	if (page !== undefined && page !== app.page) {
		app.files = listed(app.dir);
		app.page = page;
	}
	return app.files.has(path) ? path : undefined;
}

export function isAppFile(app: WebApp, path: string): boolean {
	return fileFor(app, path) !== undefined;
}

export function serveApp(app: WebApp, path: string): Served {
	const file = fileFor(app, path);
	if (file === undefined)
		return { status: 404, type: TYPES[".html"]!, headers: {}, body: "not found" };
	return {
		status: 200,
		type: TYPES[extname(file)] ?? "application/octet-stream",
		headers: {
			"content-security-policy": POLICY,
			// Hashed names never change content.
			"cache-control": file.startsWith("/assets/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
			"x-content-type-options": "nosniff",
		},
		body: readFileSync(join(app.dir, file)),
	};
}

// The page the daemon serves: the files of the page's build, listed once when the daemon starts, so a
// path a client makes up never reaches the filesystem.
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/** The addresses the page draws with its router, each answered by its one `index.html`. */
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
	/** The build's folder. */
	dir: string;
	/** Every file in it, as a path from `/`. */
	files: ReadonlySet<string>;
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

/** The page in `dir`, or undefined when there is none. The data routes answer either way. */
export function loadWebApp(dir: string): WebApp | undefined {
	if (!existsSync(join(dir, "index.html"))) return undefined;
	const files = readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => `/${relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/")}`);
	return { dir, files: new Set(files) };
}

/** `index.html` for `/` and the page's routes; undefined otherwise, so other paths reach the routes. */
export function fileFor(app: WebApp, path: string): string | undefined {
	if (path === "/" || ROUTES.some((route) => route.test(path))) return "/index.html";
	return app.files.has(path) ? path : undefined;
}

/** Whether a path is one of the page's own files, which a browser fetches before it has a login. */
export function isAppFile(app: WebApp, path: string): boolean {
	return fileFor(app, path) !== undefined;
}

/** The response for a path: the file with its type and the policy, or a 404. */
export function serveApp(app: WebApp, path: string): Served {
	const file = fileFor(app, path);
	if (file === undefined)
		return { status: 404, type: TYPES[".html"]!, headers: {}, body: "not found" };
	return {
		status: 200,
		type: TYPES[extname(file)] ?? "application/octet-stream",
		headers: {
			"content-security-policy": POLICY,
			// The build names what is under `/assets/` by its hash, so it never changes under that name.
			"cache-control": file.startsWith("/assets/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
			"x-content-type-options": "nosniff",
		},
		body: readFileSync(join(app.dir, file)),
	};
}

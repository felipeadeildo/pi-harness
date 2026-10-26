// A token good once for 60 seconds travels in the URL fragment and is traded for an HttpOnly
// cookie. Loopback needs it too: any local process reaches 127.0.0.1.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

/** How long an unused token stays good. */
export const TOKEN_MS = 60_000;
/** The cookie's name. */
export const COOKIE = "pi_remote";
/** A login lasts a year from its last use. */
const LOGIN_MS = 365 * 24 * 60 * 60_000;

interface Login {
	/** The file never holds a usable cookie. */
	hash: string;
	createdAt: number;
	seenAt: number;
}

/** The tokens handed out and the logins they became, as hashes only. */
export class Logins {
	/** A token's hash and when it stops being good. */
	readonly #tokens = new Map<string, number>();
	readonly #logins: Login[];

	readonly #now: () => number;
	readonly #warn: (message: string) => void;

	constructor(
		private readonly file: string,
		options: { now?: () => number; warn?: (message: string) => void } = {},
	) {
		this.#now = options.now ?? Date.now;
		this.#warn = options.warn ?? (() => {});
		this.#logins = readLogins(file);
	}

	/** Good once, until `expiresAt`. */
	issue(): { token: string; expiresAt: number } {
		const token = randomBytes(32).toString("base64url");
		const expiresAt = this.#now() + TOKEN_MS;
		this.#tokens.set(sha256(token), expiresAt);
		return { token, expiresAt };
	}

	/** A token used before, unknown or late gets nothing. */
	exchange(token: string): string | undefined {
		const key = sha256(token);
		const expiresAt = this.#tokens.get(key);
		// Good once, whatever happens next.
		this.#tokens.delete(key);
		const now = this.#now();
		for (const [other, until] of this.#tokens) if (until < now) this.#tokens.delete(other);
		if (expiresAt === undefined || now > expiresAt) return undefined;
		return this.grant();
	}

	/** A new login, for a device that proved who it is some other way than a token. */
	grant(): string {
		const now = this.#now();
		const cookie = randomBytes(32).toString("base64url");
		this.#logins.push({ hash: sha256(cookie), createdAt: now, seenAt: now });
		this.#save();
		return cookie;
	}

	/** Whether a cookie is a login that has not lapsed. Using it keeps it alive. */
	has(cookie: string | undefined): boolean {
		if (cookie === undefined || cookie === "") return false;
		const key = sha256(cookie);
		const login = this.#logins.find((one) => sameHash(one.hash, key));
		if (login === undefined) return false;
		const now = this.#now();
		if (now - login.seenAt > LOGIN_MS) return false;
		// Written at most once a day, so a busy client does not rewrite the file on every request.
		if (now - login.seenAt > 24 * 60 * 60_000) {
			login.seenAt = now;
			this.#save();
		}
		return true;
	}

	/** A disk that refuses keeps the login in memory until restart. */
	#save(): void {
		const now = this.#now();
		const kept = this.#logins.filter((login) => now - login.seenAt <= LOGIN_MS);
		this.#logins.splice(0, this.#logins.length, ...kept);
		const temporary = `${this.file}.${process.pid}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify(this.#logins, null, "\t")}\n`, { mode: 0o600 });
			renameSync(temporary, this.file);
		} catch (error) {
			this.#warn(
				`could not write the logins to ${this.file}, so they last until a restart: ${String(error)}`,
			);
		}
	}
}

function readLogins(file: string): Login[] {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return [];
	}
	if (!Array.isArray(value)) return [];
	return value.filter(
		(one): one is Login =>
			typeof one === "object" &&
			one !== null &&
			typeof one.hash === "string" &&
			typeof one.createdAt === "number" &&
			typeof one.seenAt === "number",
	);
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** Compares two hex digests in constant time. */
function sameHash(left: string, right: string): boolean {
	const a = Buffer.from(left, "hex");
	const b = Buffer.from(right, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}

/** What `authorize` reads of a request, so it never needs Node's types. */
export interface Asking {
	method: string;
	/** The path, without the query. */
	path: string;
	host: string | undefined;
	origin: string | undefined;
	cookie: string | undefined;
	/** A WebSocket upgrade, which a page of any origin can open unless the daemon checks. */
	upgrade: boolean;
}

export type Verdict = { ok: true } | { ok: false; status: 401 | 403 | 421; reason: string };

/** The routes a browser reaches before it holds a cookie, besides the app's own files. */
const OPEN_ROUTES: ReadonlySet<string> = new Set([
	"GET /health",
	"GET /.well-known/pi-remote",
	"POST /login",
]);

/**
 * An unknown `Host` is DNS rebinding (421). A WebSocket or a request that changes something needs
 * the daemon's own `Origin` (403), since any page can open one or post a form.
 */
export function checkPlace(request: Asking, hosts: ReadonlySet<string>): Verdict {
	const host = request.host?.toLowerCase();
	if (host === undefined || !hosts.has(host)) {
		return {
			ok: false,
			status: 421,
			reason: `this daemon does not answer to ${host ?? "no host"}`,
		};
	}
	const changes = request.method !== "GET" && request.method !== "HEAD";
	if ((request.upgrade || changes) && !isOwnOrigin(request.origin, hosts)) {
		return { ok: false, status: 403, reason: `a request from ${request.origin ?? "no origin"}` };
	}
	return { ok: true };
}

/** `checkPlace` first, then a login cookie for all but the page's files and the open routes. */
export function authorize(
	request: Asking,
	place: { hosts: ReadonlySet<string>; logins: Logins; isAppFile(path: string): boolean },
): Verdict {
	const placed = checkPlace(request, place.hosts);
	if (!placed.ok) return placed;
	const route = `${request.method} ${request.path}`;
	if (OPEN_ROUTES.has(route)) return { ok: true };
	if (request.method === "GET" && !request.upgrade && place.isAppFile(request.path)) {
		return { ok: true };
	}
	if (!place.logins.has(cookieOf(request.cookie))) {
		return { ok: false, status: 401, reason: "no login: open the remote from pi with /remote" };
	}
	return { ok: true };
}

function isOwnOrigin(origin: string | undefined, hosts: ReadonlySet<string>): boolean {
	if (origin === undefined) return false;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	return (url.protocol === "http:" || url.protocol === "https:") && hosts.has(url.host);
}

/** The login cookie in a `Cookie` header. */
export function cookieOf(header: string | undefined): string | undefined {
	for (const part of (header ?? "").split(";")) {
		const at = part.indexOf("=");
		if (at !== -1 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim();
	}
	return undefined;
}

/** The `Set-Cookie` that gives a browser its login. `secure` when the request came over TLS. */
export function loginCookie(value: string, secure: boolean): string {
	const flags = ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${LOGIN_MS / 1000}`];
	if (secure) flags.push("Secure");
	return `${COOKIE}=${value}; ${flags.join("; ")}`;
}

/** The names the daemon answers to, with its port: loopback's, and the tailnet's name and address. */
export function hostsOf(port: number, tailnet?: { name: string; ip: string }): Set<string> {
	const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
	if (tailnet !== undefined) {
		hosts.add(`${tailnet.name}:${port}`);
		hosts.add(`${tailnet.ip}:${port}`);
	}
	return hosts;
}

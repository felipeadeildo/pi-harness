// `apps/remote/scripts/csp.ts` imports from here, so the CI job tests what the daemon runs.
import { createHash } from "node:crypto";

/**
 * Every request the app makes to its own origin, plus the daemon's socket. The export writes an
 * inline script, and the page is served with its hash instead of `unsafe-inline`.
 */
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

/** Every inline script the page carries. */
export function inlineHashes(html: string): string[] {
	// A tag with `data-src` is still inline, and the browser hashes its text.
	return [...html.matchAll(/<script(?![^>]*(?<![\w-])src=)[^>]*>([\s\S]*?)<\/script>/g)].map(
		([, body = ""]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
	);
}

/** The base rules, plus the hashes of what it inlines. */
export function policyFor(html: string): string {
	const hashes = inlineHashes(html);
	if (hashes.length === 0) return POLICY;
	return POLICY.replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`);
}

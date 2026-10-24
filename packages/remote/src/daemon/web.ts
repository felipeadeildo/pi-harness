// What the daemon serves the web app with: the policy, and the hash of every script a page inlines.
// The browser check that proves it lives in `apps/remote/scripts/csp.ts` and imports from here, so
// the CI job tests the same code the daemon runs instead of a copy of it.
import { createHash } from "node:crypto";

/**
 * Every request the app makes to its own origin, plus the daemon's socket. The export writes one
 * inline script, so the page is served with that script's hash rather than with `unsafe-inline`.
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

/** The hash of every inline script the page carries, as the policy spells them. */
export function inlineHashes(html: string): string[] {
	// `data-src` is not a source: a script tag with one is inline, and the browser hashes its text.
	return [...html.matchAll(/<script(?![^>]*(?<![\w-])src=)[^>]*>([\s\S]*?)<\/script>/g)].map(
		([, body = ""]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
	);
}

/** The policy for one page: the base rules, plus the hashes of what it inlines. */
export function policyFor(html: string): string {
	const hashes = inlineHashes(html);
	if (hashes.length === 0) return POLICY;
	return POLICY.replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`);
}

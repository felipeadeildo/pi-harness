// The policy arithmetic, without a browser: what the daemon hashes when it reads the build, and what
// the page is then served with. The browser half is `bun run csp:check`, which needs an export.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { inlineHashes, policyFor, POLICY } from "./csp.ts";

const hashOf = (body: string): string =>
	`'sha256-${createHash("sha256").update(body).digest("base64")}'`;

describe("the policy the app is served with", () => {
	test("a page with nothing inlined gets the base policy, untouched", () => {
		const page = '<!doctype html><html><body><script src="/entry.js"></script></body></html>';
		expect(inlineHashes(page)).toEqual([]);
		expect(policyFor(page)).toBe(POLICY);
	});

	test("every inline script the export writes comes with its hash", () => {
		const page =
			'<script>self.__EXPO_ROUTER=1</script><script src="/a.js"></script><script>go()</script>';
		expect(inlineHashes(page)).toEqual([hashOf("self.__EXPO_ROUTER=1"), hashOf("go()")]);
		expect(policyFor(page)).toContain(hashOf("go()"));
		expect(policyFor(page)).toContain("script-src 'self'");
	});

	test("the hash is of the script's text, exactly, since that is what the browser checks", () => {
		const page = "<script>\n  start()\n</script>";
		expect(inlineHashes(page)).toEqual([hashOf("\n  start()\n")]);
	});

	test("the rest of the policy never gives way to inline scripts", () => {
		const page = "<script>start()</script>";
		const policy = policyFor(page);
		const scripts = policy.split("; ").find((part) => part.startsWith("script-src")) ?? "";
		expect(scripts).not.toContain("unsafe-inline");
		expect(policy).toContain("style-src 'self' 'unsafe-inline'");
		expect(policy).toContain("frame-ancestors 'none'");
	});
});

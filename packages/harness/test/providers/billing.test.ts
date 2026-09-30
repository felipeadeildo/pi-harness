import { expect, test } from "bun:test";

import {
	billingAttribution,
	fingerprint,
	userAgent,
} from "../../src/providers/subscription/billing.ts";

test("the user agent reads like Claude Code's", () => {
	expect(userAgent("2.1.280")).toBe("claude-cli/2.1.280 (external, cli)");
});

test("the fingerprint matches one captured from Claude Code", () => {
	expect(fingerprint("Reply with the single word: pong", "2.1.211")).toBe("f82");
});

test("a message shorter than the sampled positions is padded, not an error", () => {
	expect(fingerprint("ab", "2.1.280")).toMatch(/^[0-9a-f]{3}$/);
	expect(fingerprint("", "2.1.280")).toBe(fingerprint("0000", "2.1.280").slice(0, 3));
});

test("the attribution is the exact line Claude Code sends", () => {
	expect(billingAttribution("Reply with the single word: pong", "2.1.280")).toBe(
		"x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=cli;",
	);
});

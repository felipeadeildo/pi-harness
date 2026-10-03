import { expect, test } from "bun:test";

import { classifyFailure } from "../src/errors.ts";

// The sentence Anthropic's subscription windows answer with, copied from a real 429.
const WINDOW = `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit. Please try again later."},"request_id":"req_011Cfft5qkV9CkSsPuPWytE6"}`;

test("the subscription window is a usage limit, not a throttle", () => {
	const failure = classifyFailure(WINDOW, "anthropic");
	expect(failure.kind).toBe("usage");
	expect(failure.switchable).toBe(true);
	expect(failure.status).toBe(429);
	expect(failure.code).toBe("rate_limit_error");
	expect(failure.message).toBe(
		"This request would exceed your account's rate limit. Please try again later.",
	);
	expect(failure.requestId).toBe("req_011Cfft5qkV9CkSsPuPWytE6");
});

test("the wrappers pi adds do not hide the error", () => {
	expect(classifyFailure(`Error: ${WINDOW}`, "anthropic").kind).toBe("usage");
	expect(classifyFailure(`Retry failed after 3 attempts: ${WINDOW}`, "anthropic").kind).toBe(
		"usage",
	);
});

test("a bare rate limit keeps the retry instead of burning another account", () => {
	const failure = classifyFailure(
		`429 {"error":{"message":"Rate limited. Please try again later.","type":"rate_limit_error"}}`,
		"anthropic",
	);
	expect(failure.kind).toBe("transient");
	expect(failure.switchable).toBe(false);
});

test("a refused credential is an auth failure", () => {
	const failure = classifyFailure(
		`401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`,
		"anthropic",
	);
	expect(failure.kind).toBe("auth");
	expect(failure.status).toBe(401);
	expect(failure.switchable).toBe(false);
});

test("the spend cap is its own kind and never switches accounts", () => {
	const failure = classifyFailure(
		`429 {"type":"error","error":{"type":"rate_limit_error","message":"spend cap reached","details":{"error_code":"enforced_spend_limit_reached"}}}`,
		"anthropic",
	);
	expect(failure.kind).toBe("spend");
	expect(failure.switchable).toBe(false);
});

test("a busy server is not a limit", () => {
	expect(
		classifyFailure(
			`529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`,
			"anthropic",
		).kind,
	).toBe("overloaded");
	expect(classifyFailure("500 Internal Server Error", "anthropic").kind).toBe("server");
});

test("a transport failure is a network failure", () => {
	expect(classifyFailure(new Error("fetch failed"), "anthropic").kind).toBe("network");
});

test("a provider without rules of its own falls back to the shared ones", () => {
	// The same 429 is a plain throttle where the wording is not known to be a window.
	expect(classifyFailure(WINDOW).kind).toBe("transient");
	expect(classifyFailure(new Error("insufficient_quota")).kind).toBe("spend");
});

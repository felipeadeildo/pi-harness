// What a failed request is, so an account's limit can be told from a server, plan or token failure.
// Rules are shared plus one entry per provider; adding Codex means adding an entry.
import { isObject } from "@adeildo/pi-kit";

export const FAILURE_KINDS = [
	"usage",
	"auth",
	"spend",
	"transient",
	"overloaded",
	"server",
	"network",
	"unknown",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface Failure {
	kind: FailureKind;
	status?: number;
	code?: string;
	message: string;
	requestId?: string;
	/** A usage limit belongs to the account, so another account may serve the request. */
	switchable: boolean;
}

interface Signals {
	status?: number;
	code?: string;
	message: string;
	errorCode?: string;
}

interface Rule {
	kind: FailureKind;
	when(signals: Signals): boolean;
}

const SPEND_CODE = "enforced_spend_limit_reached";

// The wording of a plan window. A burst throttle says `Rate limited` and keeps the retry.
const USAGE = /would exceed your account|usage limit|quota|5[ -]?hour|weekly limit|out of credits/i;
const AUTH = /authentication|invalid[_ -]?(api[_ -]?key|x-api-key|grant|token)|unauthorized|oauth/i;
const RATE = /rate[ _-]?limit|too many requests|429/i;
const OVERLOADED = /overloaded|at capacity|high demand/i;
const SERVER = /internal (server )?error|api_error|bad gateway|service unavailable/i;
const NETWORK =
	/fetch failed|econnreset|econnrefused|etimedout|getaddrinfo|enotfound|eai_again|socket hang up|network|timed? ?out|terminated/i;

/** Rules every provider shares, in the order they are tried. */
const COMMON: Rule[] = [
	{
		kind: "spend",
		when: (signals) =>
			signals.errorCode === SPEND_CODE ||
			/billing|spend limit|out of budget|insufficient_quota/i.test(haystack(signals)),
	},
	{ kind: "auth", when: (signals) => signals.status === 401 || AUTH.test(haystack(signals)) },
	{ kind: "transient", when: isRateLimit },
	{
		kind: "overloaded",
		when: (signals) => signals.status === 529 || OVERLOADED.test(haystack(signals)),
	},
	{
		kind: "server",
		when: (signals) =>
			(signals.status !== undefined && signals.status >= 500) || SERVER.test(haystack(signals)),
	},
	{ kind: "network", when: (signals) => NETWORK.test(haystack(signals)) },
];

/** Rules a provider adds before the shared ones, so its own wording wins. */
const BY_PROVIDER: Record<string, Rule[]> = {
	anthropic: [
		{
			// The subscription windows answer a 429 with this sentence.
			kind: "usage",
			when: (signals) => isRateLimit(signals) && USAGE.test(haystack(signals)),
		},
	],
};

interface Body {
	code?: string;
	message?: string;
	requestId?: string;
	errorCode?: string;
}

function haystack(signals: Signals): string {
	return `${signals.code ?? ""} ${signals.message}`;
}

function isRateLimit(signals: Signals): boolean {
	return (
		signals.status === 429 || signals.code === "rate_limit_error" || RATE.test(haystack(signals))
	);
}

function asText(input: unknown): string {
	if (input instanceof Error) return input.message;
	if (typeof input === "string") return input;
	if (input === undefined || input === null) return "";
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

function parseBody(text: string): Body {
	const start = text.indexOf("{");
	if (start < 0) return {};
	try {
		const parsed: unknown = JSON.parse(text.slice(start));
		if (!isObject(parsed)) return {};
		const error = isObject(parsed.error) ? parsed.error : undefined;
		const details = error !== undefined && isObject(error.details) ? error.details : undefined;
		return {
			code: stringField(error?.type) ?? stringField(error?.code) ?? stringField(parsed.type),
			message: stringField(error?.message) ?? stringField(parsed.message),
			requestId: stringField(parsed.request_id) ?? stringField(parsed.requestId),
			errorCode: stringField(details?.error_code),
		};
	} catch {
		return {};
	}
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function statusOf(text: string): number | undefined {
	const match = /\b(4\d{2}|5\d{2})\b/.exec(text);
	return match === null ? undefined : Number(match[1]);
}

function stripWrappers(text: string): string {
	return text
		.replace(/^Error:\s*/i, "")
		.replace(/^Retry failed after \d+ attempts?:\s*/i, "")
		.replace(/^\d{3}\s*/, "")
		.trim();
}

export function classifyFailure(input: unknown, provider?: string): Failure {
	const text = asText(input);
	const body = parseBody(text);
	const status = statusOf(text);
	const signals: Signals = {
		...(status === undefined ? {} : { status }),
		...(body.code === undefined ? {} : { code: body.code }),
		...(body.errorCode === undefined ? {} : { errorCode: body.errorCode }),
		message: body.message ?? stripWrappers(text),
	};
	const rules = provider === undefined ? COMMON : [...(BY_PROVIDER[provider] ?? []), ...COMMON];
	const kind = rules.find((rule) => rule.when(signals))?.kind ?? "unknown";
	return {
		kind,
		...(signals.status === undefined ? {} : { status: signals.status }),
		...(signals.code === undefined ? {} : { code: signals.code }),
		message: signals.message,
		...(body.requestId === undefined ? {} : { requestId: body.requestId }),
		switchable: kind === "usage",
	};
}

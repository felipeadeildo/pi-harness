import { createHash } from "node:crypto";

export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

const FINGERPRINT_SALT = "59cf53e54c78";
const SAMPLED_POSITIONS = [4, 7, 20];

export function userAgent(version: string): string {
	return `claude-cli/${version} (external, cli)`;
}

/** Positions past the end of the message count as "0", the way Claude Code pads them. */
export function fingerprint(firstUserText: string, version: string): string {
	const sampled = SAMPLED_POSITIONS.map((position) => firstUserText[position] ?? "0").join("");
	return createHash("sha256")
		.update(`${FINGERPRINT_SALT}${sampled}${version}`)
		.digest("hex")
		.slice(0, 3);
}

export function billingAttribution(firstUserText: string, version: string): string {
	const stamp = `${version}.${fingerprint(firstUserText, version)}`;
	return `x-anthropic-billing-header: cc_version=${stamp}; cc_entrypoint=cli;`;
}

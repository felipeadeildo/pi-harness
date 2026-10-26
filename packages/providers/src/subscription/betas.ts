import { mergeBetas } from "@adeildo/pi-kit";

type Payload = Record<string, unknown>;

/** Pi drops its own list once an extension sets `anthropic-beta`, so this grows `payload.betas`. */
export function withClaudeCodeBetas(payload: Payload, wanted: readonly string[]): Payload {
	const { betas, added } = mergeBetas(payload.betas, wanted);
	return added ? { ...payload, betas } : payload;
}

// How fast the model writes, from the answers the page holds: output tokens over the time each
// request took, which counts the wait for the first token as pi's own clock does.

const ANSWERS = 20;

export interface Speed {
	/** Tokens per second. */
	last: number;
	/** Over the last answers, weighted by their length. */
	recent: number;
	answers: number;
}

interface Timed {
	output: number;
	ms: number;
}

export function speedOf(entries: readonly unknown[]): Speed | undefined {
	const timed: Timed[] = [];
	for (let at = entries.length - 1; at >= 0 && timed.length < ANSWERS; at--) {
		const one = timedOf(entries[at]);
		if (one !== undefined) timed.push(one);
	}
	const last = timed[0];
	if (last === undefined) return undefined;
	const output = timed.reduce((sum, one) => sum + one.output, 0);
	const ms = timed.reduce((sum, one) => sum + one.ms, 0);
	return {
		last: (last.output * 1000) / last.ms,
		recent: (output * 1000) / ms,
		answers: timed.length,
	};
}

function timedOf(entry: unknown): Timed | undefined {
	const message = (entry as { message?: unknown } | null)?.message as
		| { role?: unknown; durationMs?: unknown; usage?: { output?: unknown } }
		| undefined;
	if (message?.role !== "assistant") return undefined;
	const { durationMs } = message;
	const output = message.usage?.output;
	if (typeof durationMs !== "number" || durationMs <= 0) return undefined;
	if (typeof output !== "number" || output <= 0) return undefined;
	return { output, ms: durationMs };
}

// One request to the daemon the client talks to. A refusal carries the daemon's reason, and a body
// the decoder cannot read is an error, not a guess.

/** Keeps the code, so a screen can say "not logged in" without matching text. */
export class DaemonAnswer extends Error {
	readonly status: number;
	/** The daemon's own words for a refusal, when it gave them. */
	readonly reason: string | undefined;

	constructor(status: number, what: string, reason?: string) {
		super(`the daemon answered ${status} for ${what}`);
		this.name = "DaemonAnswer";
		this.status = status;
		this.reason = reason;
	}
}

interface Asked<T> {
	/** Names the request in an error, as "the session list". */
	what: string;
	/** Undefined when the body is not what the client expects. */
	decode: (body: unknown) => T | undefined;
	/** Sent as JSON in a POST. */
	body?: unknown;
	signal?: AbortSignal;
}

export async function ask<T>(
	base: string,
	path: string,
	asked: Asked<T>,
	speaks: typeof fetch,
): Promise<T> {
	const posts = asked.body !== undefined;
	const answer = await speaks(new URL(path, base), {
		headers: {
			accept: "application/json",
			...(posts ? { "content-type": "application/json" } : {}),
		},
		...(posts ? { method: "POST", body: JSON.stringify(asked.body) } : {}),
		...(asked.signal === undefined ? {} : { signal: asked.signal }),
	});
	if (!answer.ok) throw new DaemonAnswer(answer.status, asked.what, await reasonOf(answer));
	const decoded = asked.decode(await answer.json());
	if (decoded === undefined)
		throw new DaemonAnswer(200, `${asked.what} in a shape this client cannot read`);
	return decoded;
}

/** The daemon refuses with `{ error }`. */
async function reasonOf(answer: Response): Promise<string | undefined> {
	try {
		const body: unknown = await answer.json();
		return typeof body === "object" && body !== null && "error" in body
			? String(body.error)
			: undefined;
	} catch {
		return undefined;
	}
}

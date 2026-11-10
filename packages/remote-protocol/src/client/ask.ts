// One request to the daemon. A refusal carries its reason; a body the decoder rejects is an error.

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
	signal?: AbortSignal;
}

export async function ask<T>(
	base: string,
	path: string,
	asked: Asked<T>,
	speaks: typeof fetch,
): Promise<T> {
	const answer = await speaks(new URL(path, base), {
		headers: { accept: "application/json" },
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

/** A request the daemon will not do, with the status and the words the client shows. */
export class Refused extends Error {
	readonly status: 400 | 403 | 404 | 503 | 504;

	constructor(status: Refused["status"], message: string) {
		super(message);
		this.name = "Refused";
		this.status = status;
	}
}

/** A refusal's own status and words; anything else is a 500 with what went wrong. */
export function refusalOf(error: unknown): [number, { error: string }] {
	if (error instanceof Refused) return [error.status, { error: error.message }];
	return [500, { error: error instanceof Error ? error.message : "pi could not be started" }];
}

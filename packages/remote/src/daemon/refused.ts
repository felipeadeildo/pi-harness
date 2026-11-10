/** A request the daemon will not do, with the status and the words the client shows. */
export class Refused extends Error {
	readonly status: 400 | 403 | 404 | 503 | 504;

	constructor(status: Refused["status"], message: string) {
		super(message);
		this.name = "Refused";
		this.status = status;
	}
}

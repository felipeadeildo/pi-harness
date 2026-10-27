// The owner's machines, as the daemon the client talks to knows them. `/tailnet`, since `/machines`
// is the page that shows them.
import { isObject } from "../index.ts";
import { DaemonAnswer } from "./sessions.ts";

export interface ListedMachine {
	name: string;
	/** The machine whose daemon answered this list. */
	here: boolean;
	/** The harness version its daemon runs. */
	version: string;
	startedAt: number;
	/** When its daemon last answered; now for the ones answering. */
	seen: number;
	answering: boolean;
}

export async function listMachines(
	base: string,
	speaks: typeof fetch = fetch,
): Promise<ListedMachine[]> {
	const answer = await speaks(new URL("/tailnet", base), {
		headers: { accept: "application/json" },
	});
	if (!answer.ok) throw new DaemonAnswer(answer.status, "the machine list");
	const body: unknown = await answer.json();
	if (!Array.isArray(body)) throw new DaemonAnswer(200, "a body that is not a list");
	return body.filter(isMachine);
}

function isMachine(value: unknown): value is ListedMachine {
	return (
		isObject(value) &&
		typeof value.name === "string" &&
		typeof value.here === "boolean" &&
		typeof value.version === "string" &&
		typeof value.startedAt === "number" &&
		typeof value.seen === "number" &&
		typeof value.answering === "boolean"
	);
}

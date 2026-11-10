// The owner's machines, as the daemon the client talks to knows them. `/tailnet`, since `/machines`
// is the page that shows them.
import { isObject } from "../index.ts";
import { ask } from "./ask.ts";

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

export function listMachines(base: string, speaks: typeof fetch = fetch): Promise<ListedMachine[]> {
	return ask(
		base,
		"/tailnet",
		{
			what: "the machine list",
			decode: (body) => (Array.isArray(body) ? body.filter(isMachine) : undefined),
		},
		speaks,
	);
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

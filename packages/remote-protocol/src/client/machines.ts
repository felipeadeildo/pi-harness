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

export interface RecentFolder {
	path: string;
	/** When pi last wrote a session there, in ms. */
	at: number;
}

/** `allowed` is false until the operator turns on starting sessions at that machine. */
export interface StartPlaces {
	allowed: boolean;
	folders: RecentFolder[];
}

export function readFolders(
	base: string,
	machine: string,
	speaks: typeof fetch = fetch,
): Promise<StartPlaces> {
	return ask(
		base,
		`/machines/${encodeURIComponent(machine)}/folders`,
		{ what: "the recent folders", decode: (body) => (isStartPlaces(body) ? body : undefined) },
		speaks,
	);
}

/** Answers once pi runs and its session reached the daemon, which can take seconds. */
export function startSession(
	base: string,
	machine: string,
	folder: string,
	speaks: typeof fetch = fetch,
): Promise<{ machine: string; session: string }> {
	return ask(
		base,
		`/machines/${encodeURIComponent(machine)}/sessions`,
		{
			what: "the new session",
			body: { folder },
			decode: (body) =>
				isObject(body) && typeof body.machine === "string" && typeof body.session === "string"
					? { machine: body.machine, session: body.session }
					: undefined,
		},
		speaks,
	);
}

function isStartPlaces(value: unknown): value is StartPlaces {
	return (
		isObject(value) &&
		typeof value.allowed === "boolean" &&
		Array.isArray(value.folders) &&
		value.folders.every(
			(one) => isObject(one) && typeof one.path === "string" && typeof one.at === "number",
		)
	);
}

/** A session of a machine's remote tmux: a shell from the page, or a pi started there. */
export interface TerminalInfo {
	name: string;
	folder: string;
	/** What runs in it now, as `fish` or `pi`. */
	command: string;
	/** In ms. */
	created: number;
	/** Terminal windows on the machine that show it now; the page's own view does not count. */
	windows?: number;
	/** The pi session that runs in it, when the remote knows that pi. */
	session?: string;
}

/**
 * What a client may do to a session of a machine's remote tmux: open it in a terminal window of
 * that machine, let go of the windows that show it, end it, or end its pi and resume the pi's
 * session in a window, outside tmux. `move` waits for an idle agent.
 */
export type TerminalAction = "window" | "detach" | "stop" | "move";

export function actOnTerminal(
	base: string,
	machine: string,
	name: string,
	action: TerminalAction,
	speaks: typeof fetch = fetch,
): Promise<{ machine: string; name: string }> {
	return ask(
		base,
		`/machines/${encodeURIComponent(machine)}/terminals/${encodeURIComponent(name)}/${action}`,
		{
			what: "the terminal",
			body: {},
			decode: (body) =>
				isObject(body) && typeof body.machine === "string" && typeof body.name === "string"
					? { machine: body.machine, name: body.name }
					: undefined,
		},
		speaks,
	);
}

/** `allowed` is false until the operator turns on terminals at that machine. */
export interface TerminalList {
	allowed: boolean;
	terminals: TerminalInfo[];
}

export function listTerminals(
	base: string,
	machine: string,
	speaks: typeof fetch = fetch,
): Promise<TerminalList> {
	return ask(
		base,
		`/machines/${encodeURIComponent(machine)}/terminals`,
		{ what: "the terminals", decode: (body) => (isTerminalList(body) ? body : undefined) },
		speaks,
	);
}

/** A new shell in `folder`; its name opens it. */
export function newTerminal(
	base: string,
	machine: string,
	folder: string,
	speaks: typeof fetch = fetch,
): Promise<{ machine: string; name: string }> {
	return ask(
		base,
		`/machines/${encodeURIComponent(machine)}/terminals`,
		{
			what: "the new terminal",
			body: { folder },
			decode: (body) =>
				isObject(body) && typeof body.machine === "string" && typeof body.name === "string"
					? { machine: body.machine, name: body.name }
					: undefined,
		},
		speaks,
	);
}

function isTerminalList(value: unknown): value is TerminalList {
	return (
		isObject(value) &&
		typeof value.allowed === "boolean" &&
		Array.isArray(value.terminals) &&
		value.terminals.every(
			(one) =>
				isObject(one) &&
				typeof one.name === "string" &&
				typeof one.folder === "string" &&
				typeof one.command === "string" &&
				typeof one.created === "number",
		)
	);
}

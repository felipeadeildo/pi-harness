// The owner's other machines whose daemon answers on the tailnet. `tailscale status` names the
// owner's nodes that are online, and each one's daemon is asked for its health at the same port as
// this one. Nothing is paired: the other daemon logs this one in the way it logs in the owner's
// phone, because its `whois` says this machine belongs to the same person.
import { isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";
import { WebSocket } from "ws";

import { COOKIE, cookieOf } from "./auth.ts";
import { type AskTailscale, readOwnTailnet, type Tailnet } from "./tailnet.ts";

/** How often the tailnet is looked at again for machines that came or went. */
const LOOK_EVERY_MS = 15_000;
/** How long another daemon has to answer before it counts as not there. */
const ANSWER_MS = 2_000;

/** Another machine, as its sessions name it and as its daemon is reached. */
export interface Machine {
	/** Its hostname, which every session of it carries as its machine. */
	name: string;
	/** Where its daemon answers, `http://<tailnet address>:<port>`. */
	origin: string;
}

export interface MachinesOptions {
	/** This machine's name, which is never one of the others. */
	self: string;
	/** Where another node's daemon answers. The same port as this one's, by default. */
	originOf: (node: Tailnet) => string;
	ask?: AskTailscale;
	fetch?: typeof fetch;
	lookEvery?: number;
}

export class Machines {
	readonly #options: MachinesOptions;
	readonly #fetch: typeof fetch;
	/** The machines that answered the last look, by name. */
	#found = new Map<string, Machine>();
	/** The login each other daemon gave this one, by origin. */
	readonly #logins = new Map<string, string>();
	#timer: ReturnType<typeof setInterval> | undefined;

	constructor(options: MachinesOptions) {
		this.#options = options;
		this.#fetch = options.fetch ?? fetch;
	}

	/** Looks now, and again every so often until `stop`. */
	start(): void {
		void this.look();
		this.#timer = setInterval(() => void this.look(), this.#options.lookEvery ?? LOOK_EVERY_MS);
		this.#timer.unref?.();
	}

	stop(): void {
		clearInterval(this.#timer);
	}

	list(): Machine[] {
		return [...this.#found.values()];
	}

	named(name: string): Machine | undefined {
		return this.#found.get(name);
	}

	/** Asks the tailnet which of the owner's machines run a daemon now. */
	async look(): Promise<void> {
		const tailnet = await readOwnTailnet(this.#options.ask);
		const answered = await Promise.all(
			(tailnet?.others ?? []).map((node) => this.#health(this.#options.originOf(node))),
		);
		const found = new Map<string, Machine>();
		for (const machine of answered)
			if (machine !== undefined && machine.name !== this.#options.self)
				found.set(machine.name, machine);
		this.#found = found;
	}

	/** A GET on another machine's daemon, logged in there as a device of the owner. */
	async get(machine: Machine, path: string): Promise<Response> {
		const ask = async (): Promise<Response> =>
			this.#fetch(`${machine.origin}${path}`, {
				headers: { cookie: `${COOKIE}=${await this.#login(machine)}` },
				signal: AbortSignal.timeout(ANSWER_MS),
			});
		const answer = await ask();
		if (answer.status !== 401) return answer;
		// The other daemon forgot the login, as a restart with its file gone does: one more, once.
		this.#logins.delete(machine.origin);
		return ask();
	}

	/** A WebSocket to another machine's daemon, with its own `Origin` and the login it gave. */
	async socket(machine: Machine): Promise<WebSocket> {
		const cookie = await this.#login(machine);
		return new WebSocket(`${machine.origin.replace(/^http/, "ws")}/ws`, {
			headers: { origin: machine.origin, cookie: `${COOKIE}=${cookie}` },
		});
	}

	async #health(origin: string): Promise<Machine | undefined> {
		try {
			const answer = await this.#fetch(`${origin}/health`, {
				signal: AbortSignal.timeout(ANSWER_MS),
			});
			const body: unknown = await answer.json();
			if (!isObject(body) || body.protocol !== PROTOCOL || typeof body.machine !== "string")
				return undefined;
			return { name: body.machine, origin };
		} catch {
			return undefined;
		}
	}

	/** The login another daemon gives this one, asked for once and kept. Empty when it refused. */
	async #login(machine: Machine): Promise<string> {
		const kept = this.#logins.get(machine.origin);
		if (kept !== undefined) return kept;
		const answer = await this.#fetch(`${machine.origin}/login`, {
			method: "POST",
			headers: { origin: machine.origin, "content-type": "application/json" },
			body: "{}",
			signal: AbortSignal.timeout(ANSWER_MS),
		});
		const cookie = cookieOf(answer.headers.get("set-cookie") ?? undefined) ?? "";
		if (cookie !== "") this.#logins.set(machine.origin, cookie);
		return cookie;
	}
}

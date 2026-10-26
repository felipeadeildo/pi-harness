// The owner's other machines whose daemon answers on the tailnet, at this daemon's port. Nothing
// is paired: each daemon logs the other in by `whois`, as it does the owner's phone.
import { isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";
import { WebSocket } from "ws";

import { COOKIE, cookieOf } from "./auth.ts";
import { type AskTailscale, readOwnTailnet, type Tailnet } from "./tailnet.ts";

const LOOK_EVERY_MS = 15_000;
const ANSWER_MS = 2_000;

export interface Machine {
	name: string;
	/** `http://<tailnet address>:<port>`. */
	origin: string;
}

export interface MachinesOptions {
	self: string;
	/** The same port as this one's, by default. */
	originOf: (node: Tailnet) => string;
	ask?: AskTailscale;
}

export class Machines {
	readonly #options: MachinesOptions;
	#found = new Map<string, Machine>();
	readonly #logins = new Map<string, string>();
	#timer: ReturnType<typeof setInterval> | undefined;

	constructor(options: MachinesOptions) {
		this.#options = options;
	}

	start(): void {
		void this.look();
		this.#timer = setInterval(() => void this.look(), LOOK_EVERY_MS);
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

	/** A `tailscale` that does not answer keeps the machines found last. */
	async look(): Promise<void> {
		const tailnet = await readOwnTailnet(this.#options.ask);
		if (tailnet === undefined) return;
		const answered = await Promise.all(
			tailnet.others.map((node) => this.#health(this.#options.originOf(node))),
		);
		const found = new Map<string, Machine>();
		for (const machine of answered)
			if (machine !== undefined && machine.name !== this.#options.self)
				found.set(machine.name, machine);
		this.#found = found;
	}

	async get(machine: Machine, path: string): Promise<Response> {
		const ask = async (): Promise<Response> =>
			fetch(`${machine.origin}${path}`, {
				headers: { cookie: `${COOKIE}=${await this.#login(machine)}` },
				signal: AbortSignal.timeout(ANSWER_MS),
			});
		const answer = await ask();
		if (answer.status !== 401) return answer;
		// The other daemon forgot the login (a restart without its file): log in again, once.
		this.#logins.delete(machine.origin);
		return ask();
	}

	async socket(machine: Machine): Promise<WebSocket> {
		const cookie = await this.#login(machine);
		return new WebSocket(`${machine.origin.replace(/^http/, "ws")}/ws`, {
			headers: { origin: machine.origin, cookie: `${COOKIE}=${cookie}` },
		});
	}

	async #health(origin: string): Promise<Machine | undefined> {
		try {
			const answer = await fetch(`${origin}/health`, {
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

	async #login(machine: Machine): Promise<string> {
		const kept = this.#logins.get(machine.origin);
		if (kept !== undefined) return kept;
		const answer = await fetch(`${machine.origin}/login`, {
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

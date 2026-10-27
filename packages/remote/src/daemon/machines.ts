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
	version: string;
	/** When its daemon started, from the uptime it answered with. */
	startedAt: number;
}

/** A machine as the page shows it: one that stopped answering stays, with when it last did. */
export interface SeenMachine extends Machine {
	seen: number;
	answering: boolean;
}

export interface MachinesOptions {
	self: string;
	/** The same port as this one's, by default. */
	originOf: (node: Tailnet) => string;
	ask?: AskTailscale;
	now?: () => number;
}

export class Machines {
	readonly #options: MachinesOptions;
	#found = new Map<string, Machine>();
	/** Every machine that answered since this daemon started, with when it last did. */
	readonly #seen = new Map<string, Machine & { seen: number }>();
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

	/** The answering ones first; the rest by when they were last seen. */
	report(): SeenMachine[] {
		return [...this.#seen.values()]
			.map((one) => ({ ...one, answering: this.#found.has(one.name) }))
			.toSorted((a, b) => Number(b.answering) - Number(a.answering) || b.seen - a.seen);
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
		const now = this.#now();
		for (const machine of answered)
			if (machine !== undefined && machine.name !== this.#options.self) {
				found.set(machine.name, machine);
				this.#seen.set(machine.name, { ...machine, seen: now });
			}
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
			const version = typeof body.version === "string" ? body.version : "";
			const uptime = typeof body.uptime === "number" ? body.uptime : 0;
			return { name: body.machine, origin, version, startedAt: this.#now() - uptime };
		} catch {
			return undefined;
		}
	}

	#now(): number {
		return (this.#options.now ?? Date.now)();
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

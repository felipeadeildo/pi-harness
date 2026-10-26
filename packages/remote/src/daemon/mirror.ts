// Copies the other machines' open sessions and room logs into this machine's events. A log has one
// writer and only grows, so syncing appends what the other side has past this side's size.
import {
	appendFileSync,
	closeSync,
	fstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { isObject } from "@adeildo/pi-remote-protocol";

import type { Machine, Machines } from "./machines.ts";

const SYNC_EVERY_MS = 2_000;
/** Never a path. */
const NAME = /^[\w-][\w.-]*$/;

export interface Shared {
	presence: { session: string; host: string }[];
	rooms: Record<string, Record<string, number>>;
}

export function sharedHere(root: string, self: string): Shared {
	return { presence: openHere(root, self), rooms: roomSizes(root) };
}

export function roomBytes(
	root: string,
	room: string,
	log: string,
	from: number,
): Buffer | undefined {
	if (!NAME.test(room) || !NAME.test(log)) return undefined;
	let fd: number;
	try {
		fd = openSync(join(root, "rooms", room, log), "r");
	} catch {
		return undefined;
	}
	try {
		const bytes = Buffer.alloc(Math.max(0, fstatSync(fd).size - from));
		readSync(fd, bytes, 0, bytes.length, from);
		return bytes;
	} finally {
		closeSync(fd);
	}
}

export interface MirrorOptions {
	machines: Machines;
	root: string;
	self: string;
}

export class Mirror {
	readonly #options: MirrorOptions;
	#timer: ReturnType<typeof setInterval> | undefined;
	#syncing = false;

	constructor(options: MirrorOptions) {
		this.#options = options;
	}

	start(): void {
		this.#timer = setInterval(() => void this.sync(), SYNC_EVERY_MS);
		this.#timer.unref?.();
	}

	stop(): void {
		clearInterval(this.#timer);
	}

	async sync(): Promise<void> {
		if (this.#syncing) return;
		this.#syncing = true;
		try {
			const machines = this.#options.machines.list();
			await Promise.all(machines.map((machine) => this.#from(machine)));
			this.#forgetBut(new Set([this.#options.self, ...machines.map((one) => one.name)]));
		} finally {
			this.#syncing = false;
		}
	}

	async #from(machine: Machine): Promise<void> {
		const { machines, root } = this.#options;
		let shared: unknown;
		try {
			shared = await (await machines.get(machine, "/shared")).json();
		} catch {
			return;
		}
		if (!isShared(shared)) return;
		this.#copyPresence(machine.name, shared.presence);
		const mine = roomSizes(root);
		for (const [room, logs] of Object.entries(shared.rooms)) {
			for (const [log, size] of Object.entries(logs)) {
				const have = mine[room]?.[log] ?? 0;
				if (size <= have || !NAME.test(room) || !NAME.test(log)) continue;
				// oxlint-disable-next-line no-await-in-loop -- one log at a time, in the order they grew
				await this.#append(machine, room, log, have);
			}
		}
	}

	async #append(machine: Machine, room: string, log: string, from: number): Promise<void> {
		const path = `/rooms/${room}/${log}?from=${from}`;
		try {
			const answer = await this.#options.machines.get(machine, path);
			if (!answer.ok) return;
			const bytes = Buffer.from(await answer.arrayBuffer());
			const dir = join(this.#options.root, "rooms", room);
			mkdirSync(dir, { recursive: true });
			// A copy that grew since the list was read must not get the same bytes twice.
			if (sizeOf(join(dir, log)) !== from) return;
			appendFileSync(join(dir, log), bytes);
		} catch {
			// The next sync asks again.
		}
	}

	/** Rewritten on every sync, so its age tells a reader the machine stopped answering. */
	#copyPresence(host: string, entries: Shared["presence"]): void {
		const live = join(this.#options.root, "live");
		mkdirSync(live, { recursive: true });
		const open = new Set<string>();
		for (const entry of entries) {
			if (entry.host !== host || !NAME.test(entry.session)) continue;
			open.add(entry.session);
			const path = join(live, `${entry.session}.json`);
			writeFileSync(`${path}.mirror`, JSON.stringify(entry));
			renameSync(`${path}.mirror`, path);
		}
		for (const entry of entriesIn(live))
			if (entry.host === host && !open.has(entry.session)) rmSync(entry.path, { force: true });
	}

	#forgetBut(hosts: ReadonlySet<string>): void {
		for (const entry of entriesIn(join(this.#options.root, "live")))
			if (!hosts.has(entry.host)) rmSync(entry.path, { force: true });
	}
}

function openHere(root: string, self: string): Shared["presence"] {
	return entriesIn(join(root, "live")).flatMap(({ path, host, pid }) => {
		if (host !== self || !runs(pid)) return [];
		try {
			return [JSON.parse(readFileSync(path, "utf8")) as Shared["presence"][number]];
		} catch {
			return [];
		}
	});
}

function roomSizes(root: string): Shared["rooms"] {
	const rooms: Shared["rooms"] = {};
	for (const room of namesIn(join(root, "rooms"))) {
		const logs: Record<string, number> = {};
		for (const log of namesIn(join(root, "rooms", room)))
			if (log.endsWith(".jsonl")) logs[log] = sizeOf(join(root, "rooms", room, log));
		rooms[room] = logs;
	}
	return rooms;
}

function entriesIn(live: string): { path: string; session: string; host: string; pid: number }[] {
	return namesIn(live)
		.filter((name) => name.endsWith(".json"))
		.flatMap((name) => {
			const path = join(live, name);
			try {
				const entry: unknown = JSON.parse(readFileSync(path, "utf8"));
				if (!isObject(entry)) return [];
				const { session, host, pid } = entry;
				if (typeof session !== "string" || typeof host !== "string" || typeof pid !== "number")
					return [];
				return [{ path, session, host, pid }];
			} catch {
				return [];
			}
		});
}

function isShared(value: unknown): value is Shared {
	return (
		isObject(value) &&
		Array.isArray(value.presence) &&
		value.presence.every(
			(entry) =>
				isObject(entry) && typeof entry.session === "string" && typeof entry.host === "string",
		) &&
		isObject(value.rooms) &&
		Object.values(value.rooms).every(
			(logs) => isObject(logs) && Object.values(logs).every((size) => typeof size === "number"),
		)
	);
}

function namesIn(dir: string): string[] {
	try {
		return readdirSync(dir).filter((name) => NAME.test(name));
	} catch {
		return [];
	}
}

function sizeOf(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

function runs(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

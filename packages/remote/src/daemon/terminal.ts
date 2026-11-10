// Shells on the page: each terminal is a session of the remote's tmux, and each page that opens one
// is a tmux control-mode client (`tmux -C`), so the daemon needs no native module, and the shell
// outlives a lost connection. Off until the operator turns it on at this machine.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { globalSetting, TERMINAL_ID, TMUX_SOCKET } from "../places.ts";
import { Refused } from "./refused.ts";
import { EXTENDED_KEYS, folderOf, run } from "./tmux.ts";

/** `send-keys -H` takes one argument per byte; a long paste goes in several commands. */
const KEYS_PER_COMMAND = 256;
const FIELDS = "#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{session_created}";

export interface TerminalInfo {
	name: string;
	/** Where its shell stands now. */
	folder: string;
	/** What runs in it now, as `fish` or `pi`. */
	command: string;
	/** In ms. */
	created: number;
}

export interface Size {
	cols: number;
	rows: number;
}

/** One page's view of a terminal. */
export interface Attached {
	write(text: string): void;
	resize(size: Size): void;
	close(): void;
}

export interface TerminalOptions {
	/** The global setting by default, never a project's. */
	allowed?: () => boolean;
	tmux?: string;
}

export class Terminals {
	readonly #options: TerminalOptions;

	constructor(options: TerminalOptions = {}) {
		this.#options = options;
	}

	allowed(): boolean {
		return this.#options.allowed?.() ?? globalSetting(TERMINAL_ID) === true;
	}

	/** Every session of the remote's tmux, pi's included; none when its server is not running. */
	async list(machine: string): Promise<TerminalInfo[]> {
		this.#check(machine);
		const ran = await run(this.#tmux, ["-L", TMUX_SOCKET, "list-sessions", "-F", FIELDS]);
		if (ran.code === undefined) throw new Refused(503, `tmux is not installed on ${machine}`);
		if (ran.code !== 0) return [];
		return ran.out
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [name = "", folder = "", command = "", created = "0"] = line.split("\t");
				return { name, folder, command, created: Number(created) * 1000 };
			});
	}

	/** A new shell in the folder; its name opens it. */
	async create(folder: string, machine: string): Promise<string> {
		this.#check(machine);
		const at = await folderOf(folder);
		const name = `shell-${randomBytes(2).toString("hex")}`;
		const ran = await run(this.#tmux, [
			"-L",
			TMUX_SOCKET,
			...EXTENDED_KEYS,
			"new-session",
			"-d",
			"-s",
			name,
			"-c",
			at,
		]);
		if (ran.code === undefined) throw new Refused(503, `tmux is not installed on ${machine}`);
		if (ran.code !== 0) throw new Error(`tmux could not start the shell: ${ran.err.trim()}`);
		return name;
	}

	/**
	 * Draws the terminal's screen as it is, then everything it writes. `closed` runs once, when the
	 * shell ends or tmux goes away.
	 */
	async attach(
		name: string,
		machine: string,
		size: Size,
		sink: { output(bytes: Buffer): void; closed(why: string): void },
	): Promise<Attached> {
		this.#check(machine);
		const has = await run(this.#tmux, ["-L", TMUX_SOCKET, "has-session", "-t", `=${name}`]);
		if (has.code !== 0) throw new Refused(404, `no terminal named ${name} on ${machine}`);
		const control = new Control(this.#tmux, name, sink);
		try {
			await control.command(`refresh-client -C ${sizeOf(size)}`);
			const [where = ""] = await control.command(
				`display -p -t '=${name}:' '#{pane_id} #{cursor_x} #{cursor_y}'`,
			);
			const [pane = "", x = "0", y = "0"] = where.split(" ");
			// A control client gets only what the pane writes after it attached: the screen comes first.
			const screen = await control.command(`capture-pane -p -e -t ${pane}`);
			sink.output(
				Buffer.from(`\x1b[H\x1b[2J${screen.join("\r\n")}\x1b[${Number(y) + 1};${Number(x) + 1}H`),
			);
			control.follow(pane);
			return {
				write: (text) => {
					const bytes = Buffer.from(text, "utf8");
					for (let at = 0; at < bytes.length; at += KEYS_PER_COMMAND) {
						const hex = [...bytes.subarray(at, at + KEYS_PER_COMMAND)].map((byte) =>
							byte.toString(16).padStart(2, "0"),
						);
						void control.command(`send-keys -t ${pane} -H ${hex.join(" ")}`).catch(() => {});
					}
				},
				resize: (next) => void control.command(`refresh-client -C ${sizeOf(next)}`).catch(() => {}),
				close: () => control.close(),
			};
		} catch (error) {
			control.close();
			throw error;
		}
	}

	get #tmux(): string {
		return this.#options.tmux ?? "tmux";
	}

	#check(machine: string): void {
		if (!this.allowed())
			throw new Refused(
				403,
				`terminals from the page are off on ${machine}: turn on "${TERMINAL_ID}" in pi's settings there`,
			);
	}
}

/** Within what a terminal can be; anything else is the smallest sane one. */
function sizeOf({ cols, rows }: Size): string {
	const fit = (value: number, max: number) =>
		Number.isInteger(value) && value >= 2 && value <= max ? value : 2;
	return `${fit(cols, 1000)}x${fit(rows, 500)}`;
}

/** A tmux control-mode client: commands in, their answers and the panes' output out. */
class Control {
	readonly #child: ChildProcess;
	readonly #waiting: { resolve(lines: string[]): void; reject(error: Error): void }[] = [];
	#block: string[] | undefined;
	#ours = false;
	#pane: string | undefined;
	#rest = Buffer.alloc(0);
	#done = false;

	constructor(
		tmux: string,
		name: string,
		private readonly sink: { output(bytes: Buffer): void; closed(why: string): void },
	) {
		this.#child = spawn(tmux, ["-L", TMUX_SOCKET, "-C", "attach-session", "-t", `=${name}`], {
			stdio: ["pipe", "pipe", "ignore"],
		});
		this.#child.stdout?.on("data", (chunk: Buffer) => this.#read(chunk));
		this.#child.stdin?.on("error", () => {});
		this.#child.once("error", () => this.#end("tmux could not start"));
		this.#child.once("close", () => this.#end("the terminal closed"));
	}

	command(text: string): Promise<string[]> {
		if (this.#done) return Promise.reject(new Error("the terminal closed"));
		return new Promise((resolve, reject) => {
			this.#waiting.push({ resolve, reject });
			this.#child.stdin?.write(`${text}\n`);
		});
	}

	follow(pane: string): void {
		this.#pane = pane;
	}

	/** The page went away: the client detaches, and the shell goes on. */
	close(): void {
		if (this.#done) return;
		this.#done = true;
		for (const waiting of this.#waiting.splice(0)) waiting.reject(new Error("the page closed"));
		this.#child.stdin?.end("\n");
		this.#child.kill();
	}

	#read(chunk: Buffer): void {
		let data = Buffer.concat([this.#rest, chunk]);
		for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10)) {
			this.#line(data.subarray(0, end));
			data = data.subarray(end + 1);
		}
		this.#rest = data;
	}

	#line(line: Buffer): void {
		const text = line.toString("utf8");
		if (this.#block !== undefined && !text.startsWith("%end ") && !text.startsWith("%error ")) {
			this.#block.push(text);
			return;
		}
		if (text.startsWith("%begin ")) {
			this.#block = [];
			// The last field is 1 for a command this client sent; the attach's own block is 0.
			this.#ours = text.trimEnd().endsWith(" 1");
			return;
		}
		if (text.startsWith("%end ") || text.startsWith("%error ")) {
			const lines = this.#block ?? [];
			this.#block = undefined;
			if (!this.#ours) return;
			const waiting = this.#waiting.shift();
			if (text.startsWith("%end ")) waiting?.resolve(lines);
			else waiting?.reject(new Error(lines.join(" ") || "tmux refused the command"));
			return;
		}
		if (text.startsWith("%exit")) return this.#end("the shell ended");
		const output = outputOf(line);
		if (output !== undefined && output.pane === this.#pane) this.sink.output(output.bytes);
	}

	#end(why: string): void {
		if (this.#done) return;
		this.#done = true;
		for (const waiting of this.#waiting.splice(0)) waiting.reject(new Error(why));
		this.sink.closed(why);
	}
}

/** `%output %<pane> <data>`, where tmux writes a byte under 32 and `\` as `\ooo`. */
export function outputOf(line: Buffer): { pane: string; bytes: Buffer } | undefined {
	const head = "%output ";
	if (line.subarray(0, head.length).toString("latin1") !== head) return undefined;
	const space = line.indexOf(32, head.length);
	if (space === -1) return undefined;
	const pane = line.subarray(head.length, space).toString("latin1");
	const bytes: number[] = [];
	for (let at = space + 1; at < line.length; at++) {
		const byte = line[at] ?? 0;
		if (byte === 92 && at + 3 < line.length) {
			const code = Number.parseInt(line.subarray(at + 1, at + 4).toString("latin1"), 8);
			if (!Number.isNaN(code)) {
				bytes.push(code);
				at += 3;
				continue;
			}
		}
		bytes.push(byte);
	}
	return { pane, bytes: Buffer.from(bytes) };
}

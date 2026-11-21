// `pi-remote ls`, `window`, `detach`, `stop` and `move`: the sessions of the remote's tmux, from a
// terminal of this machine. They run tmux themselves; only `move` asks the daemon which pi it ends.
import { spawn } from "node:child_process";

import { isObject } from "@adeildo/pi-remote-protocol";

import type { Desk, Resumable } from "../daemon/desk.ts";
import { Refused } from "../daemon/refused.ts";
import { command, NO_DAEMON } from "./open.ts";

/** How the refusals name the machine. */
const HERE = "this machine";

export interface DeskVerbs {
	desk: Desk;
	socket: string;
	out: (line: string) => void;
	/** Runs pi in this terminal and ends with its code; a test passes a fake. */
	resume?: (args: readonly string[], cwd: string) => Promise<number>;
}

export async function list({ desk, out }: DeskVerbs): Promise<number> {
	const sessions = await desk.sessions(HERE);
	if (sessions.length === 0) out("No session runs in the remote's tmux.");
	for (const one of sessions)
		out(`${one.name}\t${one.command}\t${windowsOf(one.windows)}\t${one.folder}`);
	return 0;
}

/** `window`, `detach` and `stop`, which need nothing but tmux. */
export async function act(
	verb: "window" | "detach" | "stop",
	name: string,
	{ desk, out }: DeskVerbs,
): Promise<number> {
	if (verb === "window") await desk.window(name, HERE);
	if (verb === "stop") await desk.stop(name, HERE);
	if (verb === "detach")
		out(`${name} runs on; ${windowsOf(await desk.detach(name, HERE))} let go of it.`);
	return 0;
}

/** Ends the pi in the session and resumes its session here, in this terminal, outside tmux. */
export async function move(name: string, verbs: DeskVerbs): Promise<number> {
	const find = async (pid: number): Promise<Resumable | undefined> => {
		const answer = await command(verbs.socket, "session.of", { pid });
		if (answer === undefined) throw new Refused(503, NO_DAEMON);
		const data = isObject(answer.data) ? answer.data : {};
		if (answer.kind !== "reply" || typeof data.cwd !== "string") return undefined;
		return {
			cwd: data.cwd,
			...(typeof data.file === "string" ? { file: data.file } : {}),
			...(typeof data.status === "string" ? { status: data.status } : {}),
		};
	};
	const { args, cwd } = await verbs.desk.release(name, HERE, find);
	verbs.out(`Resuming ${name} here: ${["pi", ...args].join(" ")}`);
	return (verbs.resume ?? resumed)(args, cwd);
}

function resumed(args: readonly string[], cwd: string): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn("pi", args, { cwd, stdio: "inherit" });
		child.on("error", () => resolve(127));
		child.on("exit", (code) => resolve(code ?? 1));
	});
}

function windowsOf(count: number): string {
	return count === 1 ? "1 window" : `${count} windows`;
}

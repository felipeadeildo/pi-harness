// Where the remote lives on this machine. The extension, the daemon and the command read it from
// here without importing pi.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLIENT_PORT = 7878;

/** The remote's own tmux server (`tmux -L`), where the page starts sessions and `attach` opens them. */
export const TMUX_SOCKET = "pi-remote";

/** Set on a pi the daemon starts; its bridge reports it, so the daemon knows the session. */
export const TICKET_ENV = "PI_REMOTE_TICKET";

/** Set on a pi another session started, naming it. Keep in step with the kit's `STARTED_BY_ENV`. */
export const STARTED_BY_ENV = "PI_STARTED_BY";

/** The command and pi must agree on the setting's path and rule. */
export const PORT_ID = "remote.port";

/** Read by the daemon from the global settings only, so a cloned repository cannot turn it on. */
export const START_ID = "remote.startSessions";

export function portOf(value: unknown): number | undefined {
	const number = typeof value === "number" && Number.isInteger(value) ? value : undefined;
	if (number === undefined || number < 1 || number > 65_535) return undefined;
	return number;
}

/** Pi's own folder, as pi finds it. */
function agentDir(env: NodeJS.ProcessEnv): string {
	const agent = env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir());
	return agent || join(homedir(), ".pi", "agent");
}

export function daemonDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_REMOTE_DIR !== undefined && env.PI_REMOTE_DIR !== "") return env.PI_REMOTE_DIR;
	return join(agentDir(env), "harness", "remote");
}

/** The kit's events folder, spelled the same way without importing the kit. */
export function eventsDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_HARNESS_EVENTS !== undefined && env.PI_HARNESS_EVENTS !== "")
		return env.PI_HARNESS_EVENTS;
	return join(agentDir(env), "harness", "events");
}

/** Pi's settings file, for the daemon and the command, which import only Node's modules. */
function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(agentDir(env), "extensions", "pi-harness", "settings.json");
}

/** A global setting of pi, read without the kit: the same nested lookup. */
export function globalSetting(id: string, env: NodeJS.ProcessEnv = process.env): unknown {
	let node: unknown;
	try {
		node = JSON.parse(readFileSync(settingsPath(env), "utf8"));
	} catch {
		return undefined;
	}
	for (const key of id.split(".")) {
		if (typeof node !== "object" || node === null) return undefined;
		node = (node as Record<string, unknown>)[key];
	}
	return node;
}

/** Where pi keeps its sessions, one folder per working folder. */
export function piSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(agentDir(env), "sessions");
}

export function daemonPaths(dir: string): { socket: string; current: string; logins: string } {
	return {
		socket: join(dir, "daemon.sock"),
		current: join(dir, "current.json"),
		logins: join(dir, "logins.json"),
	};
}

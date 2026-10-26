// Where the remote lives on this machine. The extension, the daemon and the command read it from
// here without importing pi.
import { homedir } from "node:os";
import { join } from "node:path";

/** Where clients reach the daemon, on loopback. A setting changes it, and this is the default. */
export const CLIENT_PORT = 7878;

/** The setting's path and the rule that reads it: the command and pi have to agree on both. */
export const PORT_ID = "remote.port";

export function portOf(value: unknown): number | undefined {
	const number = typeof value === "number" && Number.isInteger(value) ? value : undefined;
	if (number === undefined || number < 1 || number > 65_535) return undefined;
	return number;
}

/** The remote's folder: `PI_REMOTE_DIR`, or `harness/remote` under pi's agent folder. */
export function daemonDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_REMOTE_DIR !== undefined && env.PI_REMOTE_DIR !== "") return env.PI_REMOTE_DIR;
	const agent = env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir());
	return join(agent || join(homedir(), ".pi", "agent"), "harness", "remote");
}

/** The kit's events folder, spelled the same way without importing the kit. */
export function eventsDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_HARNESS_EVENTS !== undefined && env.PI_HARNESS_EVENTS !== "")
		return env.PI_HARNESS_EVENTS;
	const agent = env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir());
	return join(agent || join(homedir(), ".pi", "agent"), "harness", "events");
}

/** Pi's settings file, for the daemon and the command, which import only Node's modules. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
	const agent = env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir());
	return join(
		agent || join(homedir(), ".pi", "agent"),
		"extensions",
		"pi-harness",
		"settings.json",
	);
}

export function daemonPaths(dir: string): { socket: string; current: string; logins: string } {
	return {
		socket: join(dir, "daemon.sock"),
		current: join(dir, "current.json"),
		logins: join(dir, "logins.json"),
	};
}

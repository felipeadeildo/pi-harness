// Where the remote lives on this machine. The extension, the daemon and the command read it from
// here without importing pi.
import { homedir } from "node:os";
import { join } from "node:path";

export const CLIENT_PORT = 7878;

/** The command and pi must agree on the setting's path and rule. */
export const PORT_ID = "remote.port";

export function portOf(value: unknown): number | undefined {
	const number = typeof value === "number" && Number.isInteger(value) ? value : undefined;
	if (number === undefined || number < 1 || number > 65_535) return undefined;
	return number;
}

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

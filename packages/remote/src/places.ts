// Where the remote lives on this machine: its folder, its socket, its files and its port. The
// extension, the daemon and the command all read them from here, so the three meet in the same place,
// and none of them imports pi to find it.
import { homedir } from "node:os";
import { join } from "node:path";

/** Where clients reach the daemon, on loopback. A setting would change it here, for all three. */
export const CLIENT_PORT = 7878;

/** The remote's folder: `PI_REMOTE_DIR`, or `harness/remote` under pi's agent folder. */
export function daemonDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_REMOTE_DIR !== undefined && env.PI_REMOTE_DIR !== "") return env.PI_REMOTE_DIR;
	const agent = env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir());
	return join(agent || join(homedir(), ".pi", "agent"), "harness", "remote");
}

/**
 * The settings file pi writes, for the daemon and the command, which run outside pi and may import
 * only Node's own modules. The kit owns the format; this is the path, spelled the same way.
 */
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

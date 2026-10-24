// The entry the build turns into dist/daemon.js, one daemon per machine. A bridge starts it with
// `detached: true` when nothing answers on the socket. It runs outside pi, so it finds the remote's
// folder the way pi finds its own, without importing pi.
import { homedir } from "node:os";
import { join } from "node:path";

import { VERSION } from "../version.ts";
import { CLIENT_PORT, Daemon, daemonPaths } from "./server.ts";

/** The remote's folder: `PI_REMOTE_DIR`, or `harness/remote` under pi's agent folder. */
export function daemonDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PI_REMOTE_DIR !== undefined && env.PI_REMOTE_DIR !== "") return env.PI_REMOTE_DIR;
	const agent = env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir());
	return join(agent || join(homedir(), ".pi", "agent"), "harness", "remote");
}

if (process.argv[2] === "--version") console.log(VERSION);
else {
	// When another daemon already answers on the socket, nothing is listening here and Node exits.
	await Daemon.start({
		...daemonPaths(daemonDir()),
		version: VERSION,
		clientPort: CLIENT_PORT,
		exited: () => process.exit(0),
		warn: (message) => console.error(`pi-remote daemon: ${message}`),
	});
}

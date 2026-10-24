// The entry the build turns into dist/daemon.js, one daemon per machine. A bridge starts it with
// `detached: true` when nothing answers on the socket. It runs outside pi, so it finds the remote's
// folder the way pi finds its own, without importing pi.
import { VERSION } from "../version.ts";
import { CLIENT_PORT, Daemon, daemonDir, daemonPaths } from "./server.ts";

// Only as the entry: a module that imported this file would start a daemon in the operator's real
// folder and port. The bundle keeps the check, as `require.main` for Node.
if (import.meta.main) {
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
}

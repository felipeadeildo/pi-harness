// The entry the build turns into dist/daemon.js, one daemon per machine. A bridge starts it with
// `detached: true` when nothing answers on the socket. It runs outside pi, so it finds the remote's
// folder the way pi finds its own, without importing pi.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CLIENT_PORT, daemonDir, daemonPaths } from "../places.ts";
import { VERSION } from "../version.ts";
import { findWebDir } from "./app.ts";
import { Daemon } from "./server.ts";
import { readTailnet } from "./tailnet.ts";

// Only as the entry: a module that imported this file would start a daemon in the operator's real
// folder and port. The bundle keeps the check, as `require.main` for Node.
if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args[0] === "--version") console.log(VERSION);
	else {
		// `--serve` is how `pi-remote serve --dev` runs this file: up until stopped, on its port.
		const at = args.indexOf("--port");
		const port = at === -1 ? CLIENT_PORT : Number(args[at + 1]);
		if (!Number.isInteger(port) || port < 0 || port > 65_535) {
			console.error("pi-remote daemon: --port takes a port number");
			process.exit(2);
		}
		// When another daemon already answers on the socket, nothing is listening here and Node exits.
		await Daemon.start({
			...daemonPaths(daemonDir()),
			version: VERSION,
			clientPort: port,
			stayUp: args.includes("--serve"),
			webDir: findWebDir(dirname(fileURLToPath(import.meta.url))),
			tailnet: await readTailnet(),
			exited: () => process.exit(0),
			warn: (message) => console.error(`pi-remote daemon: ${message}`),
		});
	}
}

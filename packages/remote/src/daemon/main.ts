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

/** How often the daemon looks at the tailnet for an address it does not listen on yet. */
const TAILNET_EVERY_MS = 15_000;

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
		const tailnet = await readTailnet();
		const stayUp = args.includes("--serve");
		// When another daemon already answers on the socket, nothing is listening here and Node exits.
		const daemon = await Daemon.start({
			...daemonPaths(daemonDir()),
			version: VERSION,
			clientPort: port,
			stayUp,
			webDir: findWebDir(dirname(fileURLToPath(import.meta.url))),
			tailnet,
			exited: () => process.exit(0),
			warn: (message) => console.error(`pi-remote daemon: ${message}`),
		});
		// A machine that joins its tailnet after the daemon started, or comes back on another address,
		// gets a daemon that listens there: this one makes way, and a bridge starts the next one. A
		// daemon kept up by hand has no bridge to start it again, so it stays.
		if (daemon !== undefined && !stayUp) {
			setInterval(async () => {
				const now = await readTailnet();
				if (now !== undefined && now.ip !== tailnet?.ip) daemon.stop();
			}, TAILNET_EVERY_MS).unref();
		}
	}
}

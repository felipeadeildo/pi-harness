// The remote's part inside every pi, the bridge. It keeps the launcher current, so `pi-remote`
// always runs the version of the pi that started last, and it connects this session to the
// daemon, starting the daemon when none answers.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp, defineFeature, HOST } from "@adeildo/pi-kit";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

import { BridgeConnection, type GoneReason } from "./bridge/connection.ts";
import { startDaemon, writeLauncher } from "./launcher.ts";
import { VERSION } from "./version.ts";

/** Where the remote keeps its files. `PI_REMOTE_DIR` moves it, for tests. */
export function remoteDir(): string {
	return process.env.PI_REMOTE_DIR ?? join(getAgentDir(), "harness", "remote");
}

/** The socket the daemon listens on. */
export function daemonSocket(dir: string): string {
	return join(dir, "daemon.sock");
}

/** The built daemon and command, next to this package's sources. */
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

/** How the end of a session in pi reads to the daemon. A reload is no end: the next runtime goes on. */
export function goneReason(
	reason: "quit" | "reload" | "new" | "resume" | "fork",
): GoneReason | undefined {
	switch (reason) {
		case "quit":
			return "exit";
		case "reload":
			return undefined;
		case "new":
		case "resume":
		case "fork":
			return "replaced";
	}
}

export const remote = defineFeature({
	id: "remote",
	description: "Reach your sessions from a phone, a browser or another machine",
	setup(scope) {
		let connection: BridgeConnection | undefined;

		scope.on("session_start", (_event, ctx) => {
			// Only a session in a terminal is one the remote shows, so a `pi -p` leaves no trace.
			if (ctx.mode !== "tui") return;
			const dir = remoteDir();
			try {
				writeLauncher(dir, {
					node: process.execPath,
					cli: join(DIST, "cli.js"),
					daemon: join(DIST, "daemon.js"),
					version: VERSION,
				});
			} catch (error) {
				scope.warn(`could not write the pi-remote launcher: ${String(error)}`);
			}
			const startedAt = Date.now();
			const opened = new BridgeConnection(
				{
					path: daemonSocket(dir),
					machine: HOST,
					session: ctx.sessionManager.getSessionId(),
					// Every runtime is a new epoch, so a client takes a snapshot instead of trusting a gap.
					epoch: randomUUID(),
					version: VERSION,
				},
				{
					connected() {
						opened.event("session.live", {
							pid: process.pid,
							startedAt,
							cwd: ctx.cwd,
							name: ctx.sessionManager.getSessionName(),
							kind: "terminal",
						});
					},
					startDaemon: () => startDaemon(dir),
					warn: (message) => scope.warn(message),
				},
			);
			connection = opened;
			opened.start();
		});

		scope.on("session_shutdown", async (event) => {
			const closing = connection;
			connection = undefined;
			await closing?.close(goneReason(event.reason));
		});
	},
});

export default function piRemote(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-remote" }).use(remote).build();
}

// The remote's part inside every pi, the bridge. This first slice keeps the launcher current, so
// `pi-remote` always runs the version of the pi that started last.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp, defineFeature } from "@adeildo/pi-kit";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

import { writeLauncher } from "./launcher.ts";
import { VERSION } from "./version.ts";

/** Where the remote keeps its files. `PI_REMOTE_DIR` moves it, for tests. */
export function remoteDir(): string {
	return process.env.PI_REMOTE_DIR ?? join(getAgentDir(), "harness", "remote");
}

/** The built daemon and command, next to this package's sources. */
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

export const remote = defineFeature({
	id: "remote",
	description: "Reach your sessions from a phone, a browser or another machine",
	setup(scope) {
		scope.on("session_start", (_event, ctx) => {
			// Only a session in a terminal is one the remote shows, so a `pi -p` leaves no trace.
			if (ctx.mode !== "tui") return;
			try {
				writeLauncher(remoteDir(), {
					node: process.execPath,
					cli: join(DIST, "cli.js"),
					daemon: join(DIST, "daemon.js"),
					version: VERSION,
				});
			} catch (error) {
				scope.warn(`could not write the pi-remote launcher: ${String(error)}`);
			}
		});
	},
});

export default function piRemote(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-remote" }).use(remote).build();
}

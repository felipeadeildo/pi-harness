// The remote's part inside every pi, the bridge. It keeps the launcher current, so `pi-remote`
// always runs the version of the pi that started last, and it publishes this session to the daemon,
// starting the daemon when none answers.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp, defineFeature, piSource } from "@adeildo/pi-kit";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

import { Bridge, type SessionKind } from "./bridge/bridge.ts";
import type { GoneReason } from "./bridge/connection.ts";
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

/**
 * Which sessions the remote shows: one in a terminal, and one in RPC mode whose starter set
 * `PI_REMOTE_SHARE=1`, as the runner does. A `pi -p` or a subagent leaves no trace.
 */
export function sessionKind(mode: string): SessionKind | undefined {
	if (mode === "tui") return "terminal";
	if (mode === "rpc" && process.env.PI_REMOTE_SHARE === "1") return "background";
	return undefined;
}

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
		// The source registers its own handlers, so it is made while the extension loads.
		const source = piSource(scope);
		let bridge: Bridge | undefined;

		scope.on("session_start", (_event, ctx) => {
			const kind = sessionKind(ctx.mode);
			if (kind === undefined) return;
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
			bridge = new Bridge(ctx, source, {
				path: daemonSocket(dir),
				version: VERSION,
				kind,
				startDaemon: () => startDaemon(dir),
				warn: (message) => scope.warn(message),
			});
			bridge.start();
		});

		scope.on("message_start", (event) => bridge?.stream.messageStart(event));
		scope.on("message_update", (event) => bridge?.stream.messageUpdate(event));
		scope.on("message_end", (event) => bridge?.stream.messageEnd(event));
		scope.on("tool_execution_start", (event) => bridge?.stream.toolStart(event));
		scope.on("tool_execution_update", (event) => bridge?.stream.toolUpdate(event));
		scope.on("tool_execution_end", (event) => bridge?.stream.toolEnd(event));
		scope.on("turn_end", (event) => bridge?.stream.turnEnd(event));
		scope.on("session_tree", (event) => {
			// A tree with no leaf left has no branch to draw, and a client keeps the one it holds.
			if (event.newLeafId !== null) bridge?.event("leaf.changed", { leaf: event.newLeafId });
		});
		// pi's JSON mode has no form for a model change, so this one keeps the style of the others.
		scope.on("model_select", (event) =>
			bridge?.event("pi.model_select", {
				type: "model_select",
				model: { provider: event.model.provider, id: event.model.id },
				source: event.source,
			}),
		);
		scope.on("thinking_level_select", (event) =>
			bridge?.event("pi.thinking_level_select", {
				type: "thinking_level_select",
				level: event.level,
			}),
		);
		scope.on("session_info_changed", (event) =>
			bridge?.event("pi.session_info_changed", { type: "session_info_changed", name: event.name }),
		);

		scope.on("session_shutdown", async (event) => {
			const ending = bridge;
			bridge = undefined;
			await ending?.stop(goneReason(event.reason));
		});
	},
});

export default function piRemote(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-remote" }).use(remote).build();
}

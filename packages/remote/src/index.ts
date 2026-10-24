// The remote's part inside every pi, the bridge. It keeps the launcher current, so `pi-remote`
// always runs the version of the pi that started last, and it publishes this session to the daemon,
// starting the daemon when none answers.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createApp,
	defineFeature,
	followSessionStatus,
	isObject,
	LOGGED_EVENT,
	piSource,
	provideProtected,
	SESSION_STATUS,
} from "@adeildo/pi-kit";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { ClientAsks } from "./bridge/asks.ts";
import { Bridge, type SessionKind } from "./bridge/bridge.ts";
import type { GoneReason } from "./bridge/connection.ts";
import { openInBrowser } from "./browser.ts";
import { linkOf } from "./cli/open.ts";
import { commandApi } from "./commands-api.ts";
import { startDaemon, writeLauncher } from "./launcher.ts";
import { CLIENT_PORT, daemonDir, daemonPaths } from "./places.ts";
import { VERSION } from "./version.ts";

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
		followSessionStatus(scope, (message) => scope.warn(message));
		// The agent runs as you, so the permission feature asks before any call that reaches the remote:
		// it could answer its own question, drive another session, or read the machine's key.
		provideProtected(scope.events, () => {
			const dir = daemonDir();
			return {
				paths: [dir],
				sockets: [daemonPaths(dir).socket, `127.0.0.1:${CLIENT_PORT}`, `localhost:${CLIENT_PORT}`],
				commands: ["pi-remote"],
			};
		});
		let bridge: Bridge | undefined;
		let asks: ClientAsks | undefined;

		scope.on("session_start", (_event, ctx) => {
			const kind = sessionKind(ctx.mode);
			if (kind === undefined) return;
			const dir = daemonDir();
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
				path: daemonPaths(dir).socket,
				scope,
				version: VERSION,
				kind,
				api: commandApi(scope, ctx),
				startDaemon: () => startDaemon(dir),
				warn: (message) => scope.warn(message),
			});
			bridge.start();
			// A session with no terminal has no dialog to draw, so the questions go to the clients.
			if (kind === "background") {
				asks = new ClientAsks({
					events: scope.events,
					send: (event) => bridge?.event(event.type, event.data),
					warn: (message) => scope.warn(message),
				});
				asks.start();
			}
		});

		scope.onShutdown(() => {
			asks?.stop();
			asks = undefined;
		});
		// A follow-up waits for this: the run is over, so what a client held goes in now.
		scope.on("agent_settled", () => bridge?.settled());
		/**
		 * A compaction is the other moment a follow-up is held for, and it ends no run: pi emits this
		 * before it clears the flag that makes a send throw, so the queue is drained on the next turn
		 * of the loop, once the flag is gone, and only if pi would take a prompt then.
		 */
		const afterCompaction = (_event: unknown, ctx: ExtensionContext): void => {
			setTimeout(() => {
				if (ctx.isIdle()) bridge?.settled();
			}, 0);
		};
		scope.on("session_compact", afterCompaction);
		scope.on("session_compact_failed", afterCompaction);
		scope.on("message_start", (event) => bridge?.stream.messageStart(event));
		scope.on("message_update", (event) => bridge?.stream.messageUpdate(event));
		scope.on("message_end", (event) => bridge?.stream.messageEnd(event));
		scope.on("tool_execution_start", (event) => bridge?.stream.toolStart(event));
		scope.on("tool_execution_update", (event) => bridge?.stream.toolUpdate(event));
		scope.on("tool_execution_end", (event) => bridge?.stream.toolEnd(event));
		scope.on("turn_end", (event) => bridge?.stream.turnEnd(event));
		// A leaf of null is the root: the branch is empty, and a client drops what it drew.
		scope.on("session_tree", (event) => bridge?.event("leaf.changed", { leaf: event.newLeafId }));
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

		SESSION_STATUS.onChanged(scope, (state) => {
			if (state !== undefined) bridge?.status(state);
		});
		// Every line the kit logs is published inside the process too, and the bridge keeps the facts.
		scope.events.on(LOGGED_EVENT, (line: unknown) => {
			if (!isObject(line) || typeof line.session !== "string" || typeof line.type !== "string")
				return;
			bridge?.logged({ session: line.session, type: line.type, data: line.data });
		});

		scope.registerCommand("remote", {
			description: "Open this machine's sessions in a browser, with a link good once for a minute",
			handler: async (_args, ctx) => {
				const link = linkOf(await bridge?.request("token.issue", {}), "the daemon did not answer");
				if ("reason" in link) {
					ctx.ui.notify(`pi-remote: ${link.reason}, so there is no link yet`, "warning");
					return;
				}
				openInBrowser(link.url);
				ctx.ui.notify(`pi-remote: ${link.url} works once, for a minute`, "info");
			},
		});

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

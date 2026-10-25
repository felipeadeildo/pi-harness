// The remote's part inside every pi, the bridge. It keeps the launcher current, so `pi-remote`
// always runs the version of the pi that started last, and it publishes this session to the daemon,
// starting the daemon when none answers.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createApp,
	defineFeature,
	bySession,
	followSessionStatus,
	isObject,
	LOGGED_EVENT,
	logFrom,
	piSource,
	provideProtected,
	SESSION_STATUS,
} from "@adeildo/pi-kit";
import { PROMPT_KINDS, type PromptKind } from "@adeildo/pi-remote-protocol";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { ClientAsks } from "./bridge/asks.ts";
import { Bridge, type SessionKind } from "./bridge/bridge.ts";
import { Commands, Refused } from "./bridge/commands.ts";
import type { GoneReason } from "./bridge/connection.ts";
import { forwardDialogs } from "./bridge/dialogs.ts";
import { letterOf, SessionInbox } from "./bridge/inbox.ts";
import { commandsFor } from "./bridge/slash.ts";
import { openInBrowser } from "./browser.ts";
import { linkOf } from "./cli/open.ts";
import { commandApi } from "./commands-api.ts";
import { startDaemon, writeLauncher } from "./launcher.ts";
import { CLIENT_PORT, daemonDir, daemonPaths } from "./places.ts";
import { forwardOtherDialogs, port } from "./settings.ts";
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
	settings: [port, forwardOtherDialogs],
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
		let inbox: SessionInbox | undefined;
		let commands: Commands | undefined;
		let restoreDialogs: (() => void) | undefined;

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
			// The inbox is built here, where the wiring lives: its delivery goes through the same api the
			// commands use, and what it announces comes back through the bridge, which folds the state.
			const api = commandApi(scope, ctx);
			inbox = new SessionInbox(scope, {
				send: (text, deliverAs) => api.send(text, deliverAs),
				busy: () => api.busy(),
				arrived: (text, by) => api.arrived(text, by),
				queued: (queue) => bridge?.queued(queue),
			});
			inbox.start();
			bridge = new Bridge(ctx, source, {
				path: daemonPaths(dir).socket,
				scope,
				version: VERSION,
				kind,
				command: (message) => commands?.run(message),
				api,
				// `FeatureScope` is the extension API, so the list of slash commands is asked here.
				offered: () => commandsFor(scope.getCommands()),
				startDaemon: () => startDaemon(dir, port.get(scope)),
				warn: (message) => scope.warn(message),
			});
			bridge.start();
			// The commands are built here, where the inbox, the api and the dialogs of this session meet.
			commands = new Commands({
				session: ctx.sessionManager.getSessionId(),
				effects: {
					abort: () => ctx.abort(),
					compact: (instructions) =>
						ctx.compact(
							instructions === undefined ? undefined : { customInstructions: instructions },
						),
					rename: (name) => api.rename(name),
					setModel: (provider, id) => api.setModel(provider, id),
					setThinking: (level) => api.setThinking(level),
					setMode: (mode, by) => api.setMode(mode, by),
					prompt: (id, by, text, deliverAs) =>
						inbox?.put(letterOf(id, by, text, deliverAs ?? "followUp")),
					clearQueue: (ids) => inbox?.take(ids) ?? [],
					answerAsk: (fields, by) => {
						const ask = typeof fields.ask === "string" ? fields.ask : "";
						bridge?.answer(ask, fields.result, by);
					},
					stop: (force) => {
						if (force)
							throw new Refused("a forced stop needs a background session, which has a runner");
						bridge?.cancelAsks();
						ctx.abort();
						ctx.shutdown();
					},
				},
				history: bridge.ran(),
				answer: (kind, type, data, id) => bridge?.connection.answer(kind, type, data, id),
				received: (id, command, by) => {
					logFrom(ctx, scope.events, "command.received", { id, command, by });
				},
				outcome: (id, command, by, outcome) => {
					logFrom(ctx, scope.events, "command.outcome", { id, command, by, outcome });
				},
			});
			// A session with no terminal has no dialog to draw, so the questions go to the clients.
			if (kind === "background") {
				asks = new ClientAsks({
					events: scope.events,
					send: (event) => bridge?.connection.event(event.type, event.data),
					warn: (message) => scope.warn(message),
				});
				asks.start();
			}
			// A terminal session has a dialog to race: the clients answer pi's and other extensions' too.
			if (kind === "terminal") {
				restoreDialogs?.();
				restoreDialogs = forwardDialogs(ctx.ui, {
					events: scope.events,
					ctx,
					terminal: () => bySession("terminal", scope, ctx.sessionManager),
					enabled: () => forwardOtherDialogs.get(scope),
				});
			}
		});

		scope.onShutdown(() => {
			asks?.stop();
			asks = undefined;
			restoreDialogs?.();
			restoreDialogs = undefined;
		});
		// A follow-up waits for this: the run is over, so what a client held goes in now.
		scope.on("agent_settled", () => inbox?.settle());
		// And a run that starts is the proof that the prompt which started it is in: until it arrives
		// the letter stays in the queue, so a send pi drops is visible instead of lost.
		scope.on("agent_start", () => inbox?.started());
		// Only the terminal can answer `custom()` and the editor, so clients say it waits. The other
		// dialogs reach the clients as asks they can answer.
		const onlyTerminal = (kind: string): kind is PromptKind =>
			PROMPT_KINDS.some((one) => one === kind);
		scope.on("ui_prompt_start", (event) => {
			if (onlyTerminal(event.kind)) bridge?.prompted(true, event.kind, event.title);
		});
		scope.on("ui_prompt_end", (event) => {
			if (onlyTerminal(event.kind)) bridge?.prompted(false, event.kind, undefined);
		});
		/**
		 * A compaction is the other moment a follow-up is held for, and it ends no run: pi emits this
		 * before it clears the flag that makes a send throw, so the queue is drained on the next turn
		 * of the loop, once the flag is gone, and only if pi would take a prompt then. The app owns
		 * that turn: a session that ends first takes the deferral with it.
		 */
		const afterCompaction = (_event: unknown, ctx: ExtensionContext): void => {
			scope.defer(() => {
				if (ctx.isIdle()) inbox?.settle();
			});
		};
		scope.on("session_compact", afterCompaction);
		scope.on("session_compact_failed", afterCompaction);
		scope.on("message_start", (event) => bridge?.stream.messageStart(event));
		scope.on("message_update", (event) => bridge?.stream.messageUpdate(event));
		scope.on("message_end", (event) => bridge?.stream.messageEnd(event));
		scope.on("tool_execution_start", (event) => bridge?.stream.toolStart(event));
		scope.on("tool_execution_update", (event) => bridge?.stream.toolUpdate(event));
		scope.on("tool_execution_end", (event) => bridge?.stream.toolEnd(event));
		scope.on("turn_end", (event) => {
			bridge?.stream.turnEnd(event);
			// The turn's cost is only whole after its last message was forwarded, so it goes after the
			// stream binds the entry, not on the way in.
			bridge?.charged();
		});
		// A leaf of null is the root: the branch is empty, and a client drops what it drew.
		scope.on("session_tree", (event) => {
			bridge?.connection.event("leaf.changed", { leaf: event.newLeafId });
		});
		// pi's JSON mode has no form for a model change, so this one keeps the style of the others.
		scope.on("model_select", (event) => {
			bridge?.connection.event("pi.model_select", {
				type: "model_select",
				model: { provider: event.model.provider, id: event.model.id },
				source: event.source,
			});
		});
		scope.on("thinking_level_select", (event) => {
			bridge?.connection.event("pi.thinking_level_select", {
				type: "thinking_level_select",
				level: event.level,
			});
		});
		scope.on("session_info_changed", (event) => {
			bridge?.connection.event("pi.session_info_changed", {
				type: "session_info_changed",
				name: event.name,
			});
		});

		SESSION_STATUS.onChanged(scope, (state) => {
			if (state !== undefined) bridge?.connection.event("session.status", { status: state });
		});
		// Every line the kit logs is published inside the process too, and the bridge keeps the state changes.
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

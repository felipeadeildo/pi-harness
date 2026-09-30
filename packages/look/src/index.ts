// The look: pi's start screen, editor, footer and working line, redrawn around the data I want in
// front of me, in the colours of whatever theme is on. One feature, because the pieces share one clock
// and one git probe; each piece has its own switch in the settings.
import { createApp, defineFeature, type FeatureScope } from "@adeildo/pi-kit";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { type GitState, readGit } from "./data/git.ts";
import { emptySnapshot, type Snapshot, SnapshotReader } from "./data/snapshot.ts";
import { Telemetry } from "./data/telemetry.ts";
import { REQUEST_ENTRY, type RequestRecord } from "./data/totals.ts";
import { DESKTOP_THEME } from "./desktop/palette.ts";
import { syncDesktopTheme, watchDesktopPalette } from "./desktop/sync.ts";
import { resolveIcons } from "./render/glyphs.ts";
import { PLAIN, themePaint } from "./render/paint.ts";
import { claimedStatuses, renderSegments, SEGMENTS } from "./render/segments.ts";
import {
	below,
	bottomLeft,
	bottomRight,
	cursor,
	desktop,
	desktopSource,
	frame,
	gaugeCells,
	header,
	icons,
	labels,
	LOOK_SETTINGS,
	pathLength,
	peek,
	separator,
	SEPARATORS,
	strip,
	topLeft,
	topRight,
} from "./settings.ts";
import { applyCursor, LookEditor } from "./ui/editor.ts";
import { FooterComponent, StripComponent } from "./ui/footer.ts";
import { HeaderComponent, type LoadedCounts } from "./ui/header.ts";
import type { Screen, SlotName } from "./ui/screen.ts";
import { type Activity, describe, draftedTool } from "./ui/working.ts";

export { SEGMENT_IDS, SEGMENTS, type SegmentId } from "./render/segments.ts";
export { ROLE_TOKENS } from "./render/paint.ts";
export { desktopTheme, parseDesktopColors } from "./desktop/palette.ts";

const STRIP_WIDGET = "pi-look:strip";
const TICK_MS = 500;
/** The thinking tail changes on every token; the spinner line does not need to. */

interface Live {
	ctx: ExtensionContext | undefined;
	footerData: ReadonlyFooterDataProvider | undefined;
	tui: TUI | undefined;
	repaint: (() => void) | undefined;
	git: GitState | undefined;
	probing: boolean;
	ticker: ReturnType<typeof setInterval> | undefined;
	stopWatching: (() => void) | undefined;
	/** The frame's snapshot, shared by every component drawn in the same frame. */
	frame: Snapshot | undefined;
	activity: string | undefined;
}

export const look = defineFeature({
	id: "look",
	description:
		"The start screen, a framed editor, the footer and a working line that says what runs",
	settings: LOOK_SETTINGS,
	setup(scope) {
		const telemetry = new Telemetry();
		const reader = new SnapshotReader();
		const live: Live = {
			ctx: undefined,
			footerData: undefined,
			tui: undefined,
			repaint: undefined,
			git: undefined,
			probing: false,
			ticker: undefined,
			stopWatching: undefined,
			frame: undefined,
			activity: undefined,
		};

		const screen = createScreen(scope, live, reader, telemetry);
		const repaint = () => live.repaint?.();

		for (const entry of LOOK_SETTINGS) entry.listen(scope, repaint);
		frame.listen(scope, () => live.ctx && installEditor(live.ctx, screen, live, scope));
		header.listen(scope, () => live.ctx && installHeader(live.ctx, screen, scope));
		cursor.listen(scope, (style) => live.tui && applyCursor(live.tui, style));
		peek.listen(scope, (on) => !on && live.ctx?.ui.setWorkingMessage());

		scope.onSessionStart(async (ctx) => {
			live.ctx = ctx;
			telemetry.reset();
			void probeGit(live);
			if (ctx.mode !== "tui") return;

			ctx.ui.setFooter(
				(tui, _theme, data) =>
					new FooterComponent(tui, data, screen, {
						attach: (footerData, paint) => {
							live.footerData = footerData;
							live.repaint = paint;
						},
						detach: () => {
							live.footerData = undefined;
							live.repaint = undefined;
						},
					}),
			);
			ctx.ui.setWidget(STRIP_WIDGET, () => new StripComponent(screen), {
				placement: "aboveEditor",
			});
			installEditor(ctx, screen, live, scope);
			installHeader(ctx, screen, scope);
			if (desktop.get(scope)) await startDesktopSync(ctx, scope, live);
		});

		scope.onShutdown(() => {
			stopTicking(live);
			live.stopWatching?.();
			live.stopWatching = undefined;
			const ctx = live.ctx;
			if (ctx?.mode === "tui") {
				ctx.ui.setFooter(undefined);
				ctx.ui.setWidget(STRIP_WIDGET, undefined);
				ctx.ui.setHeader(undefined);
				ctx.ui.setEditorComponent(undefined);
				ctx.ui.setWorkingMessage();
			}
			if (live.tui !== undefined) applyCursor(live.tui, "block");
			live.ctx = undefined;
			live.tui = undefined;
		});

		scope.on("agent_start", () => {
			telemetry.runStarted();
			setActivity(live, scope, { kind: "waiting" });
			startTicking(live);
		});

		scope.on("turn_start", () => {
			telemetry.requestStarted();
			setActivity(live, scope, { kind: "waiting" });
		});

		scope.on("message_start", (event) => {
			if (event.message.role === "assistant") telemetry.answerStarted();
		});

		scope.on("message_update", (event) => {
			const message = event.message;
			if (message.role !== "assistant") return;
			const update = event.assistantMessageEvent;
			const delta = "delta" in update ? update.delta : "";
			telemetry.answerGrew(delta, message.usage);

			if (update.type === "thinking_start" || update.type === "thinking_delta") {
				setActivity(live, scope, { kind: "thinking" });
			} else if (update.type === "text_delta" || update.type === "text_start") {
				setActivity(live, scope, { kind: "writing" });
			} else if (update.type === "toolcall_start" || update.type === "toolcall_delta") {
				const tool = draftedTool(message.content);
				if (tool !== undefined) setActivity(live, scope, { kind: "drafting", tool });
			}
		});

		scope.on("message_end", (event) => {
			if (event.message.role !== "assistant") return;
			const record = telemetry.answerEnded(event.message.usage);
			// Kept in the session, so the average speeds survive a resume, and the usage ledger gets a
			// duration, which pi does not record.
			if (record !== undefined) scope.appendEntry<RequestRecord>(REQUEST_ENTRY, record);
			repaint();
		});

		scope.on("tool_execution_start", (event) => {
			setActivity(live, scope, { kind: "running", tool: event.toolName });
		});

		// A command may have moved the branch or touched the tree.
		scope.on("tool_execution_end", () => void probeGit(live));

		scope.on("agent_end", () => {
			telemetry.runEnded();
			stopTicking(live);
			live.activity = undefined;
			live.ctx?.ui.setWorkingMessage();
			repaint();
		});

		scope.on("agent_settled", () => void probeGit(live));
		scope.on("model_select", repaint);
		scope.on("thinking_level_select", repaint);
		scope.on("session_compact", repaint);
		scope.on("session_tree", repaint);

		scope.registerCommand("look", {
			description:
				"Look: `explain` says what every piece on screen is, `theme` switches to the desktop theme",
			getArgumentCompletions: (prefix) =>
				["explain", "theme"]
					.filter((name) => name.startsWith(prefix.trim()))
					.map((name) => ({ value: name, label: name })),
			handler: async (args, ctx) => {
				const action = args.trim();
				if (action === "" || action === "explain") {
					ctx.ui.notify(explain(screen), "info");
					return;
				}
				if (action !== "theme") {
					ctx.ui.notify("usage: /look explain | /look theme", "info");
					return;
				}
				const result = await syncDesktopTheme(desktopSource.get(scope));
				if (result.kind === "missing" || result.kind === "invalid") {
					const why = result.kind === "missing" ? "no palette file" : result.reason;
					ctx.ui.notify(`look: cannot build the desktop theme: ${why}`, "warning");
					return;
				}
				const switched = ctx.ui.setTheme(DESKTOP_THEME);
				ctx.ui.notify(
					switched.success
						? `look: now on the ${DESKTOP_THEME} theme, from ${desktopSource.get(scope)}`
						: `look: wrote ${result.path}, but pi did not load it: ${switched.error ?? "unknown"}`,
					switched.success ? "info" : "warning",
				);
			},
		});
	},
});

const SLOT_TITLES: Record<SlotName, string> = {
	strip: "Above the editor, this answer",
	topLeft: "Frame, top left",
	topRight: "Frame, top right",
	bottomLeft: "Frame, bottom left",
	bottomRight: "Frame, bottom right",
	below: "Below the editor, the session",
};

/** Every piece on screen, where it is, what it shows now and what it means. */
function explain(screen: Screen): string {
	const snapshot = screen.snapshot();
	const paint = screen.paint();
	const lines: string[] = [paint.bold("What is on screen")];
	for (const name of Object.keys(SLOT_TITLES) as SlotName[]) {
		const ids = screen.slot(name);
		if (ids.length === 0) continue;
		lines.push("", paint.role("brand", SLOT_TITLES[name]));
		for (const id of ids) {
			const [piece] = renderSegments([id], {
				snapshot,
				glyphs: screen.glyphs(),
				paint,
				options: screen.options(),
			});
			const meaning = id.startsWith("status:")
				? `what ${id.slice("status:".length)} reports`
				: (SEGMENTS[id as keyof typeof SEGMENTS]?.describe ?? "");
			const shown = piece === undefined ? paint.dim("(nothing yet)") : piece.text;
			lines.push(`  ${shown}`, `    ${paint.dim(`${id}: ${meaning}`)}`);
		}
	}
	lines.push(
		"",
		paint.dim("Arrows are from where you sit: ↑ in is sent to the model, ↓ out comes back."),
		paint.dim(
			"Slots and labels live under look. in ~/.pi/agent/extensions/pi-harness/settings.json.",
		),
	);
	return lines.join("\n");
}

function createScreen(
	scope: FeatureScope,
	live: Live,
	reader: SnapshotReader,
	telemetry: Telemetry,
): Screen {
	const slots: Record<SlotName, typeof strip> = {
		strip,
		topLeft,
		topRight,
		bottomLeft,
		bottomRight,
		below,
	};

	return {
		snapshot() {
			const ctx = live.ctx;
			if (ctx === undefined) return emptySnapshot();
			// Every component of one frame renders in the same tick, so they share one read.
			if (live.frame !== undefined) return live.frame;
			const snapshot = reader.read(ctx, {
				branch: live.footerData?.getGitBranch() ?? null,
				git: live.git,
				request: telemetry.request(),
				last: telemetry.last(),
				run: telemetry.run(),
				statuses: live.footerData?.getExtensionStatuses() ?? new Map(),
			});
			live.frame = snapshot;
			queueMicrotask(() => {
				live.frame = undefined;
			});
			return snapshot;
		},
		glyphs: () => resolveIcons(icons.get(scope)),
		paint: (border) => (live.ctx === undefined ? PLAIN : themePaint(live.ctx.ui.theme, border)),
		separator: () => SEPARATORS[separator.get(scope)],
		options: () => ({
			pathLength: pathLength.get(scope),
			gaugeCells: gaugeCells.get(scope),
			labels: labels.get(scope),
			claimed: claimedStatuses(Object.values(slots).map((entry) => entry.get(scope))),
		}),
		slot: (name) => slots[name].get(scope),
		frameStyle: () => frame.get(scope),
		cursor: () => cursor.get(scope),
	};
}

function installEditor(
	ctx: ExtensionContext,
	screen: Screen,
	live: Live,
	scope: FeatureScope,
): void {
	if (ctx.mode !== "tui") return;
	if (frame.get(scope) === "off") {
		ctx.ui.setEditorComponent(undefined);
		return;
	}
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		live.tui = tui;
		applyCursor(tui, cursor.get(scope));
		return new LookEditor(tui, theme, keybindings, screen);
	});
}

function installHeader(ctx: ExtensionContext, screen: Screen, scope: FeatureScope): void {
	if (ctx.mode !== "tui") return;
	if (header.get(scope) === "off") {
		ctx.ui.setHeader(undefined);
		return;
	}
	ctx.ui.setHeader(
		() =>
			new HeaderComponent(screen, {
				style: () => header.get(scope),
				counts: () => loadedCounts(scope),
			}),
	);
}

/** What loaded, from pi's own lists: active tools, skill and prompt commands, extension files. */
function loadedCounts(pi: ExtensionAPI): LoadedCounts {
	const commands = pi.getCommands();
	const extensions = new Set<string>();
	for (const command of commands) {
		if (command.source === "extension") extensions.add(command.sourceInfo.path);
	}
	for (const tool of pi.getAllTools()) {
		const source = tool.sourceInfo.source;
		if (source !== "builtin" && source !== "sdk") extensions.add(tool.sourceInfo.path);
	}
	return {
		tools: pi.getActiveTools().length,
		skills: commands.filter((command) => command.source === "skill").length,
		prompts: commands.filter((command) => command.source === "prompt").length,
		extensions: extensions.size,
	};
}

async function startDesktopSync(ctx: ExtensionContext, scope: FeatureScope, live: Live) {
	const source = desktopSource.get(scope);
	const sync = async () => {
		const result = await syncDesktopTheme(source);
		if (result.kind === "invalid") scope.warn(`desktop theme: ${result.reason}`);
		return result;
	};

	const first = await sync();
	if (first.kind === "missing") return;
	if (first.kind === "written" && ctx.ui.theme.name !== DESKTOP_THEME) {
		ctx.ui.notify(`look: wrote the ${DESKTOP_THEME} theme. /look theme switches to it.`, "info");
	}
	live.stopWatching?.();
	live.stopWatching = watchDesktopPalette(source, () => void sync());
}

function setActivity(live: Live, scope: FeatureScope, activity: Activity): void {
	if (!peek.get(scope)) return;
	const message = describe(activity);
	if (message === live.activity) return;
	live.activity = message;
	live.ctx?.ui.setWorkingMessage(message);
}

/** Only one at a time, and never while a render is waiting on it. */
async function probeGit(live: Live): Promise<void> {
	const ctx = live.ctx;
	if (ctx === undefined || live.probing) return;
	live.probing = true;
	try {
		live.git = await readGit(ctx.cwd);
		live.repaint?.();
	} finally {
		live.probing = false;
	}
}

/** The clocks have to move on their own while the model thinks and nothing else happens. */
function startTicking(live: Live): void {
	stopTicking(live);
	live.ticker = setInterval(() => live.repaint?.(), TICK_MS);
	live.ticker.unref?.();
}

function stopTicking(live: Live): void {
	if (live.ticker === undefined) return;
	clearInterval(live.ticker);
	live.ticker = undefined;
}

export default function piLook(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-look" }).use(look).build();
}

import { createApp, defineFeature } from "@adeildo/pi-kit";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	getCapabilities,
	getCellDimensions,
	type TerminalColors,
	type TUI,
} from "@earendil-works/pi-tui";

import { diagramsSection } from "./prompt.ts";
import { diagramTransformer } from "./transform.ts";

export { diagramsSection } from "./prompt.ts";
export { diagramTransformer, type Surface } from "./transform.ts";

const PROBE = "pi-diagrams:probe";
const COLOR_REPLY_MS = 1000;
const FALLBACK_ROWS = 40;
/** Rows of the screen a diagram leaves to the editor and the footer. */
const RESERVED_ROWS = 6;

export const diagrams = defineFeature({
	id: "diagrams",
	description:
		"Draws Mermaid blocks as diagrams in the colors of the theme, while they are written",
	setup(scope) {
		let session: ExtensionContext | undefined;
		let tui: TUI | undefined;
		let terminal: TerminalColors = {};

		scope.onSessionStart((ctx) => {
			session = ctx;
			if (ctx.mode !== "tui") return;
			if (getCapabilities().images !== null && piDrawsMermaid(ctx))
				scope.warn(
					"pi turns Mermaid blocks into text art before they reach the diagrams. Set Mermaid rendering to off in /settings to see them as pictures.",
				);
			// Pi asks the terminal for its colors at start and keeps them to itself; a widget is the
			// one way to the TUI that asks, and it draws nothing.
			ctx.ui.setWidget(PROBE, (ui) => {
				tui = ui;
				void ui.queryTerminalColors({ timeoutMs: COLOR_REPLY_MS }).then((colors) => {
					terminal = colors;
					if (session === ctx) ctx.ui.setWidget(PROBE, undefined);
				});
				return { render: () => [], invalidate: () => {} };
			});
		});
		scope.onShutdown(() => {
			session = undefined;
			tui = undefined;
		});

		scope.on("before_agent_start", (event) => {
			if (event.systemPromptOptions.customPrompt) return;
			event.systemPromptOptions.sections.diagrams = diagramsSection();
		});

		scope.registerMarkdownTransformer(
			diagramTransformer({
				theme: () => (session?.mode === "tui" ? session.ui.theme : undefined),
				terminal: () => terminal,
				images: () => getCapabilities().images,
				hyperlinks: () => getCapabilities().hyperlinks,
				cell: getCellDimensions,
				rows: () => Math.max(8, (tui?.terminal.rows ?? FALLBACK_ROWS) - RESERVED_ROWS),
			}),
			{ messageTypes: ["user", "assistant", "summary"] },
		);
	},
});

/** Pi's own transform runs before every extension's, so its art would take every block first. */
function piDrawsMermaid(ctx: ExtensionContext): boolean {
	const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	});
	return settings.getMermaidRenderingMode() !== "off";
}

export default function piDiagrams(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-diagrams" }).use(diagrams).build();
}

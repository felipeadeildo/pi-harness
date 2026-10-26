import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

// The Alt+T key and its wiring to the board contract; the board itself is its own feature.
import { defineFeature } from "../app/feature.ts";
import { BOARD } from "../contracts/board.ts";
import { hideImagesUnderOverlays } from "../overlay-images.ts";
import { BoardPanel } from "./board-panel.ts";
import { emptyBoard } from "./model.ts";

export const boardPanel = defineFeature({
	id: "board-panel",
	description: "The Alt+T panel, reading the session's board",
	setup(scope) {
		scope.registerShortcut(Key.alt("t"), {
			description: "The session's board: what it is doing, what waits and what it delivered",
			handler: (ctx) => open(ctx),
		});

		async function open(ctx: ExtensionContext): Promise<void> {
			if (ctx.mode !== "tui") return;
			let stopWatching: (() => void) | undefined;
			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					hideImagesUnderOverlays(tui);
					stopWatching = BOARD.onChanged(scope, () => tui.requestRender());
					return new BoardPanel({
						theme,
						close: () => done(),
						requestRender: () => tui.requestRender(),
						read: () => BOARD.current(scope) ?? emptyBoard(),
					});
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: "70%", minWidth: 60, maxHeight: "80%" },
				},
			);
			stopWatching?.();
		}
	},
});

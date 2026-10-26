// The Alt+T panel lives here: it opens the session's board. The board is the kit's feature; this
// module only gives the panel a key and wires it to the contract.
import { BOARD, defineFeature, emptyBoard, hideImagesUnderOverlays } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { BoardPanel } from "./board-panel.ts";

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

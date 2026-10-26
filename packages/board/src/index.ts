// The board on its own: the kit's board feature, which keeps the session's board and gives the agent
// its tool, and the Alt+T panel that reads it. The harness mounts both with the names.
import { board, createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { boardPanel } from "./panel.ts";

export { boardPanel };

export default function piBoard(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-board" }).use(board).use(boardPanel).build();
}

import { boardPanel, tasks } from "@adeildo/pi-board";
import { board, createApp, names } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessTasks(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(tasks).use(names()).use(board).use(boardPanel).build();
}

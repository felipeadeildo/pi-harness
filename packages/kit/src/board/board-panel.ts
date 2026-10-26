import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey } from "@earendil-works/pi-tui";

// The Alt+T panel reads the board: one line per open card, the column in a fixed width, the wait
// named by the kit's translation. It only reads; the agent writes the board with the tool.
import { boardLines } from "./lines.ts";
import { boardView, emptyBoard, type Board } from "./model.ts";

export interface BoardPanelOptions {
	theme: Theme;
	close: () => void;
	requestRender: () => void;
	read?: () => Board;
}

export class BoardPanel implements Component {
	readonly #options: BoardPanelOptions;

	constructor(options: BoardPanelOptions) {
		this.#options = options;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const board = this.#options.read?.() ?? emptyBoard();
		const lines = boardLines(boardView(board), this.#options.theme, width, "operator");
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "alt+t") || data === "q")
			this.#options.close();
	}
}

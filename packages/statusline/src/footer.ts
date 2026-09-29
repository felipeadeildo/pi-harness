// The footer component. Pi calls the factory once per session, hands it the theme and the footer data,
// and calls render whenever something changed.
import type { ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import { renderLines, SEPARATORS, type SeparatorStyle, type Separators } from "./line.ts";
import { PRESETS } from "./presets.ts";
import { type Paint, renderParts, type SegmentOptions, type SessionData } from "./segments.ts";
import type { StatuslinePreset } from "./settings.ts";

export interface FooterInput {
	branch: string | null;
	statuses: readonly string[];
}

export interface StatuslineSource {
	/** Read fresh on every render, so the lines are never a frame behind. */
	data(input: FooterInput): SessionData;
	options(): SegmentOptions;
	preset(): StatuslinePreset;
	separator(): SeparatorStyle;
	/** Lets the feature ask for a repaint when the numbers move between renders. */
	attach(repaint: () => void): void;
}

export class StatuslineFooter implements Component {
	readonly #tui: TUI;
	readonly #theme: Theme;
	readonly #footerData: ReadonlyFooterDataProvider;
	readonly #source: StatuslineSource;
	readonly #stopWatching: () => void;

	constructor(
		tui: TUI,
		theme: Theme,
		footerData: ReadonlyFooterDataProvider,
		source: StatuslineSource,
	) {
		this.#tui = tui;
		this.#theme = theme;
		this.#footerData = footerData;
		this.#source = source;
		this.#stopWatching = footerData.onBranchChange(() => this.#tui.requestRender());
		source.attach(() => this.#tui.requestRender());
	}

	render(width: number): string[] {
		const paint = this.paint();
		const preset = PRESETS[this.#source.preset()];
		const options = this.#source.options();
		const data = this.#source.data({
			branch: this.#footerData.getGitBranch(),
			statuses: [...this.#footerData.getExtensionStatuses().values()],
		});

		const lines = preset.lines.map((groups) =>
			groups.map((group) => ({
				id: group.id,
				parts: renderParts(group.segments, data, options, paint),
			})),
		);

		return renderLines(lines, width, {
			separators: separatorsOf(this.#source.separator()),
			cutOrder: preset.cutOrder,
			dim: paint.dim,
		});
	}

	/** Nothing is cached between renders, so there is nothing to drop. */
	invalidate(): void {}

	dispose(): void {
		this.#stopWatching();
	}

	private paint(): Paint {
		const theme = this.#theme;
		return {
			dim: (text) => theme.fg("dim", text),
			context: (percent, text) => {
				if (percent > 90) return theme.fg("error", text);
				if (percent > 70) return theme.fg("warning", text);
				return text;
			},
		};
	}
}

export function separatorsOf(style: SeparatorStyle): Separators {
	return SEPARATORS[style];
}

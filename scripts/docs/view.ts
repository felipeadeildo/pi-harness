// Another session over the screen, drawn from the session file the rig recorded, on a terminal of
// 80 columns and 24 rows.
import { join, resolve } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { fileSource, type SessionSource } from "../../packages/kit/src/index.ts";
import { SessionView } from "../../packages/look/src/view/view.ts";
import { screen } from "./look.ts";

const RECORDING = join(
	resolve(import.meta.dir, "../.."),
	"packages/remote-protocol/test/fixtures/recording/session.jsonl",
);

/** The recording read as it is, with a fixed machine, so the picture is the same on every computer. */
function recording(): SessionSource {
	const file = fileSource(RECORDING);
	return {
		open: () => file.open(),
		follow: (after, on) =>
			file.follow(after, (item) =>
				on(
					item.kind === "summary"
						? { kind: "summary", summary: { ...item.summary, machine: "server" } }
						: item,
				),
			),
	};
}

export function drawView(theme: Theme): string[] {
	const tui = { terminal: { rows: 24, columns: 80 }, requestRender: () => {} } as unknown as TUI;
	const view = new SessionView({
		tui,
		theme,
		screen: screen(theme),
		source: recording(),
		close: () => {},
	});
	try {
		return view.render(80);
	} finally {
		view.dispose();
	}
}
